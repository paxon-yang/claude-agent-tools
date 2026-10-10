// auto-router：让 Claude Code 每一轮自动选模型
// - 你发出新任务时（turn.start）判断难度：先看关键词，拿不准再问 Haiku 5.5
// - 本轮发给模型的每个请求（turn.step）都改成选中的模型和 effort
// - 子代理按类型分配模型
// - 保护：Haiku 改动范围变大/要跑危险命令时交给 Sonnet；本轮连续失败当场升档；
//         降档要连续确认；窗口装不下不切；计划模式用 Opus，批准计划后执行改用 Sonnet
// - /route 查看和手动控制
import type { EngineInterface, Register } from 'claude-code'
import {
  CLASSIFIER_SYSTEM, DEFAULTS, NAMES, ORDER, classifierPrompt, guardDowngrade, guardHysteresis, guardWindow,
  isHandback, isRisky, mergeConfig, parseClassifier, ruleDecide, subagentTier, tierOf, up,
} from './rules'
import type { Config, Decision, Effort, Tier } from './rules'

type Mode = 'auto' | 'off' | Tier
type Logged = Decision & { at: number; prompt: string; model: string }
type Loop = { files: Set<string>; errors: number; escalated: boolean }

// 模块内的状态（插件重新加载时会重置；"上一轮用的档"另外存在 $.store 里）
let cfg: Config = DEFAULTS
let mode: Mode = 'auto'
let current: Tier | undefined // 主会话当前的档
let pendingDown: Tier | undefined // 等待确认的降档
let mainTurn: string | undefined // 主会话正在进行的这一轮
let permissionMode = 'default'
let lastWasPlan = false // 上一轮是不是在计划模式里想方案
const byTurn = new Map<string, Decision>()
const bySub = new Map<string, { tier: Tier; effort: Effort; type: string }>()
const helpers = new Set<string>()
const loops = new Map<string, Loop>() // 'main' 或子代理 id → 本轮的改动和失败统计
const history: Logged[] = []
let lastTurnErrors = 0
let advisorCalls = 0
let logFile: string | undefined

const label = (d: { tier: Tier; effort: Effort }) => `${NAMES[d.tier]} · ${d.effort}`
const short = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const loopOf = (key: string): Loop => {
  let l = loops.get(key)
  if (!l) {
    l = { files: new Set(), errors: 0, escalated: false }
    loops.set(key, l)
  }
  return l
}
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const text = await $.fs.read(`${$.plugin.root}/config.json`)
      cfg = mergeConfig(DEFAULTS, JSON.parse(String(text)))
    } catch {
      cfg = DEFAULTS
    }
    const saved = await $.store.get('mode')
    mode = saved === 'off' || tierOf(String(saved)) ? (saved as Mode) : 'auto'
    try {
      const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
      if (home && (await $.fs.exists(`${home}/.claude/viz`))) {
        logFile = `${home}/.claude/viz/router/${await $.session.id()}.json`
      }
    } catch {
      logFile = undefined
    }
    await $.command.register({
      name: 'route',
      description: '自动选模型：查看状态，或 /route auto|off|haiku|sonnet|opus|fable|rules',
      argumentHint: '[auto|off|haiku|sonnet|opus|fable|rules]',
      immediate: true,
    })
    $.ui.status(mode === 'off' ? '⇄ 自动选模型：已关闭' : mode === 'auto' ? '⇄ 自动选模型：待命' : `⇄ 固定 ${NAMES[mode]}`)
    return next(e)
  })

  // 记下这一句是不是在计划模式里发的（Shift+Tab 切换）
  on('classic.UserPromptSubmit', ($, e, next) => {
    permissionMode = String(e.permission_mode ?? 'default')
    return next(e)
  }).catch(($, e, next) => next(e))

  // 新任务开始：决定这一轮用哪个模型
  on('turn.start', async ($, e, next) => {
    if (mode === 'off') return next(e)
    const sid = await $.session.id()
    if (current === undefined) {
      current = tierOf(String((await $.store.get(`last:${sid}`)) ?? ''))
      pendingDown = tierOf(String((await $.store.get(`pending:${sid}`)) ?? ''))
      lastWasPlan = (await $.store.get(`plan:${sid}`)) === true
    }
    let d: Decision | undefined
    if (mode === 'auto' && isHandback(e.text)) {
      // 后台子代理交回结果：主会话只是整理汇报，沿用上一轮的模型，不当成新任务重新判断
      // 汇总交回的结果用便宜一档（默认 Sonnet），不让 Opus 在长对话里一遍遍重读几十万 token
      const cur = current ?? cfg.defaultTier
      const ht = cfg.handbackTier
      const t = ht && ORDER.indexOf(ht) < ORDER.indexOf(cur) ? ht : cur
      const prev = byTurn.size ? [...byTurn.values()].pop() : undefined
      d = t === cur
        ? { tier: t, effort: prev?.tier === t ? prev.effort : cfg.effort[t], reason: '子代理交回结果，沿用上一轮', source: 'continue' }
        : { tier: t, effort: cfg.effort[t], reason: `子代理交回结果，用 ${NAMES[t]} 汇总`, source: 'continue' }
      let tok = 0
      try { tok = (await $.session.usage()).context.tokens ?? 0 } catch { tok = 0 }
      d = guardWindow(d, cur, tok, cfg)
      mainTurn = e.turnId
      loops.set('main', { files: new Set(), errors: 0, escalated: false })
      byTurn.set(e.turnId, d)
      current = d.tier
      history.push({ ...d, at: Date.now(), prompt: '（子代理交回结果）', model: cfg.models[d.tier] })
      if (history.length > 30) history.shift()
      void writeLog($)
      return next(e)
    }
    if (mode !== 'auto') {
      d = { tier: mode, effort: cfg.effort[mode], reason: '/route 固定', source: 'pin' }
    } else {
      d = ruleDecide(e.text, current, lastTurnErrors, cfg)
      if (d?.source !== 'manual' && permissionMode === 'plan') {
        d = { tier: cfg.planTier, effort: 'high', reason: `计划模式：${NAMES[cfg.planTier]} 想方案，批准后换 ${NAMES[cfg.executeTier]} 执行`, source: 'rule', phase: 'plan' }
      } else if (d?.source !== 'manual' && lastWasPlan) {
        // 你退出计划模式后发的第一句（比如"执行"）：按计划执行，换执行档
        const t = cfg.executeTier
        d = { tier: t, effort: cfg.effort[t], reason: `计划已定，执行改用 ${NAMES[t]}`, source: 'phase' }
      }
      if (!d) {
        const r = await $.model.complete({
          model: cfg.classifierModel,
          system: CLASSIFIER_SYSTEM,
          prompt: classifierPrompt(e.text, current),
          maxTokens: 120,
          effort: 'low',
          timeoutMs: cfg.classifierTimeoutMs,
        })
        d = r.isAnswered ? parseClassifier(r.text, cfg) : undefined
        if (!d) d = { tier: cfg.defaultTier, effort: cfg.effort[cfg.defaultTier], reason: '判断失败，用默认档', source: 'fallback' }
      }
      let tokens = 0
      try {
        tokens = (await $.session.usage()).context.tokens ?? 0
      } catch {
        tokens = 0
      }
      d = guardDowngrade(d, current, tokens, cfg)
      const h = guardHysteresis(d, current, pendingDown, cfg)
      d = h.decision
      pendingDown = h.pending
      d = guardWindow(d, current, tokens, cfg)
    }
    lastWasPlan = d.phase === 'plan'
    await $.store.set(`plan:${sid}`, lastWasPlan)
    mainTurn = e.turnId
    loops.set('main', { files: new Set(), errors: 0, escalated: false })
    adopt($, e.turnId, d, short(e.text, 60))
    await $.store.set(`last:${sid}`, d.tier)
    await $.store.set(`pending:${sid}`, pendingDown ?? '')
    return next(e)
  })

  // 每个发给模型的请求：改成选中的模型
  on('turn.step', async function* ($, e, next) {
    if (mode === 'off') return yield* next(e)
    if (e.agentId) {
      if (helpers.has(e.agentId)) return yield* next(e)
      let s = bySub.get(e.agentId)
      if (!s) {
        const info = (await $.agent.list()).find(a => a.id === e.agentId)
        const type = info?.type ?? ''
        // 不认识的（Claude Code 内部的小助手，比如给后台子代理写进度摘要）不去动它的模型
        if (!type) {
          helpers.add(e.agentId)
          if (helpers.size > 500) helpers.clear()
          return yield* next(e)
        }
        const tier = mode === 'auto' ? subagentTier(type, current, cfg) : mode
        s = { tier, effort: cfg.subagentEffort[tier], type }
        bySub.set(e.agentId, s)
        if (bySub.size > 200) bySub.delete(bySub.keys().next().value as string)
        $.ui.log(`⇄ 子代理 ${type} → ${label(s)}`)
        void writeLog($)
      }
      return yield* next({ ...e, model: cfg.models[s.tier], effort: s.effort })
    }
    const d = byTurn.get(e.turnId) ?? (current ? { tier: current, effort: cfg.effort[current] } : undefined)
    if (!d) return yield* next(e)
    const result = yield* next({ ...e, model: cfg.models[d.tier], effort: d.effort })
    const advice = (result.serverToolUses ?? []).filter(u => u.name === 'advisor').length
    if (advice) {
      advisorCalls += advice
      $.ui.toast(`顾问已介入（第 ${advisorCalls} 次）`)
      void writeLog($)
    }
    return result
  })

  // 工具调用：Haiku 的保护、连续失败升档、计划批准后换执行档
  on('tool.call', async ($, e, next) => {
    if (mode !== 'auto') return next(e)
    const key = e.agentId ?? 'main'
    const loop = loopOf(key)
    const tier = e.agentId ? bySub.get(e.agentId)?.tier : mainTurn ? byTurn.get(mainTurn)?.tier : undefined
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    if (tier === 'haiku') {
      const to = cfg.haikuGuard.escalateTo
      if (EDIT_TOOLS.has(tool)) {
        const file = String(input.file_path ?? input.notebook_path ?? '')
        if (file) loop.files.add(file)
        if (loop.files.size > cfg.haikuGuard.maxFiles) {
          escalate($, key, to, `改动超过 ${cfg.haikuGuard.maxFiles} 个文件，换 ${NAMES[to]} 接手`)
          return { deny: `auto-router：这个任务的改动范围比预想的大，已换成 ${NAMES[to]} 接手。之前的修改都保留，请从这一步（修改 ${file}）继续。` }
        }
      }
      if (tool === 'Bash' && isRisky(String(input.command ?? ''), cfg)) {
        escalate($, key, to, `要执行危险命令，换 ${NAMES[to]} 判断`)
        return { deny: `auto-router：这条命令有风险（${short(String(input.command ?? ''), 60)}），已换成 ${NAMES[to]} 接手。请重新判断是否真的需要执行。` }
      }
    }

    const r = await next(e)
    const denied = !!r && typeof r === 'object' && 'deny' in r && !!(r as { deny?: string }).deny
    const failed = !!r && typeof r === 'object' && 'isError' in r && (r as { isError?: boolean }).isError === true
    if (failed) {
      loop.errors++
      if (!loop.escalated && loop.errors >= cfg.midTurnEscalateAfterErrors && tier && tier !== 'fable') {
        const to = up(tier, cfg)
        if (to !== tier) escalate($, key, to, `这一轮已失败 ${loop.errors} 次，当场升档`)
      }
    }

    // 计划模式里批准了计划：这一轮剩下的执行工作换成执行档
    if (tool === 'ExitPlanMode' && !failed && !denied && !e.agentId && mainTurn) {
      const d = byTurn.get(mainTurn)
      if (d?.phase === 'plan' && d.tier !== cfg.executeTier) {
        const t = cfg.executeTier
        adopt($, mainTurn, { tier: t, effort: cfg.effort[t], reason: `计划已批准，执行改用 ${NAMES[t]}`, source: 'rule' }, '（计划已批准）')
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      lastTurnErrors = loops.get('main')?.errors ?? 0
      loops.delete('main')
    } else {
      loops.delete(e.agentId)
    }
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'auto' || arg === 'off' || tierOf(arg)) {
      mode = arg as Mode
      await $.store.set('mode', mode)
      $.ui.status(mode === 'off' ? '⇄ 自动选模型：已关闭' : mode === 'auto' ? '⇄ 自动选模型：待命' : `⇄ 固定 ${NAMES[mode]}`)
      void writeLog($)
      const said =
        mode === 'auto' ? '已恢复自动选模型。'
        : mode === 'off' ? '已关闭自动选模型，之后用 /model 里设的模型。'
        : `已固定为 ${NAMES[mode]}，每一轮都用它（子代理也是）。输入 /route auto 恢复自动。`
      return { text: said + '（这个选择会记住，下次打开 Claude Code 仍然有效）' }
    }
    if (arg === 'rules') return { text: rulesText() }
    return { text: statusText() }
  })
}

/** 定下（或改变）主会话这一轮的档：记录、状态栏、换档提示、看板日志 */
function adopt($: EngineInterface, turnId: string, d: Decision, prompt: string) {
  const before = current
  byTurn.set(turnId, d)
  if (byTurn.size > 50) byTurn.delete(byTurn.keys().next().value as string)
  current = d.tier
  $.ui.status(`⇄ ${label(d)} — ${d.reason}`)
  if (before !== undefined && before !== d.tier) $.ui.toast(`模型切换：${NAMES[before]} → ${NAMES[d.tier]}（${d.reason}）`)
  history.push({ ...d, at: Date.now(), prompt, model: cfg.models[d.tier] })
  if (history.length > 30) history.shift()
  void writeLog($)
}

/** 本轮内当场升档：主会话改这一轮剩下的请求；子代理改它之后的请求 */
function escalate($: EngineInterface, key: string, to: Tier, reason: string) {
  const loop = loopOf(key)
  loop.escalated = true
  if (key === 'main') {
    if (mainTurn) adopt($, mainTurn, { tier: to, effort: to === 'haiku' ? cfg.effort.haiku : 'high', reason, source: 'escalate' }, '（本轮中途升档）')
    return
  }
  const s = bySub.get(key)
  if (s) {
    bySub.set(key, { ...s, tier: to, effort: cfg.subagentEffort[to] })
    $.ui.toast(`子代理 ${s.type}：${NAMES[s.tier]} → ${NAMES[to]}（${reason}）`)
    void writeLog($)
  }
}

function statusText(): string {
  const head =
    mode === 'auto' ? '模式：自动' : mode === 'off' ? '模式：已关闭（/route auto 打开）' : `模式：固定 ${NAMES[mode]}（/route auto 恢复自动）`
  const now = current ? `当前主会话：${NAMES[current]}` : '当前主会话：还没开始'
  const wait = pendingDown ? `（等待确认：下一轮仍是简单任务就降到 ${NAMES[pendingDown]}）` : ''
  const rows = history.slice(-10).reverse().map(h => {
    const t = new Date(h.at).toTimeString().slice(0, 5)
    return `  ${t}  ${NAMES[h.tier].padEnd(10)} ${h.effort.padEnd(6)} ${h.reason}  「${h.prompt}」`
  })
  const subs = [...bySub.values()].slice(-6).map(s => `  ${s.type} → ${NAMES[s.tier]} · ${s.effort}`)
  return [
    head, now + wait, `顾问介入：${advisorCalls} 次`, '',
    '最近的选择（新的在上）：', ...(rows.length ? rows : ['  （还没有）']),
    ...(subs.length ? ['', '最近的子代理：', ...subs] : []),
    '', '命令：/route auto | off | haiku | sonnet | opus | fable | rules',
  ].join('\n')
}

function rulesText(): string {
  const subs = Object.entries(cfg.subagents).map(([k, v]) => `${k}→${v === 'main' ? '跟主会话' : NAMES[v]}`).join('，')
  const k = (n: number) => `${Math.round(n / 1000)}k`
  return [
    '自动选模型的规则（按顺序判断）：',
    '1. 提示里写了 #haiku / #sonnet / #opus / #fable → 用你指定的',
    '2. 只回了"继续/好的/ok"之类 → 沿用上一轮',
    `3. 上一轮工具失败 ≥ ${cfg.escalateAfterToolErrors} 次，或你说"还是不对/又错了" → 升一档`,
    `4. 计划模式（Shift+Tab）→ ${NAMES[cfg.planTier]} 想方案，批准计划后这一轮换 ${NAMES[cfg.executeTier]} 执行`,
    `5. 多步骤大任务（按文档/方案修改、@文档、很长、列了 4 条以上要求）→ 主会话 ${NAMES[cfg.bigTaskTier]} 统筹`,
    `6. 提到架构、重构、迁移、安全、性能、审查等 → ${NAMES.opus}`,
    `7. 提问、解释、查找、总结、翻译、改名等，且不要求改代码 → ${NAMES.haiku}`,
    `8. 其他情况 → 让 ${NAMES.haiku} 判断难度（失败时用 ${NAMES[cfg.defaultTier]}）`,
    '',
    '保护：',
    `· ${cfg.noDowngradeAboveTokens == null ? '对话再长也允许降档' : `对话超过 ${k(cfg.noDowngradeAboveTokens)} 时不降档`}；降档要连续 ${cfg.downgradeConfirmations} 轮都判成更便宜的档`,
    `· 后台子代理交回结果时，主会话用 ${cfg.handbackTier ? NAMES[cfg.handbackTier] : '上一轮的模型'} 汇总`,
    `· 对话超过目标模型窗口的八成时不切过去（Haiku 窗口按 ${k(cfg.windows.haiku ?? 0)} 算）`,
    `· 一轮里工具失败 ${cfg.midTurnEscalateAfterErrors} 次 → 当场把这一轮剩下的请求升一档`,
    `· Haiku 一轮里改到第 ${cfg.haikuGuard.maxFiles + 1} 个文件，或要执行危险命令 → 换 ${NAMES[cfg.haikuGuard.escalateTo]} 接手`,
    '',
    `Fable 主力：${cfg.autoFable ? '最难任务、反复失败时自动启用' : '只在你写 #fable 时启用'}；顾问由 /advisor 设置，与这里无关`,
    `子代理：${subs}；其他类型 → ${cfg.subagentDefault === 'main' ? '跟主会话' : NAMES[cfg.subagentDefault]}`,
    '改规则：编辑 ~/.claude/auto-router/config.json，然后重开 Claude Code',
  ].join('\n')
}

async function writeLog($: EngineInterface) {
  if (!logFile) return
  try {
    await $.fs.write(logFile, JSON.stringify({ mode, current, pendingDown, advisorCalls, decisions: history, subagents: [...bySub.values()].slice(-20) }, null, 1))
  } catch {
    /* 看板没装也没关系 */
  }
}

export const _internal = { ORDER }

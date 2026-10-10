// auto-router：让 Claude Code 每一轮自动选模型
// - 你发出新任务时（turn.start）判断难度：先看关键词，拿不准再问 Haiku 5.5
// - 本轮发给模型的每个请求（turn.step）都改成选中的模型和 effort
// - 子代理按类型分配模型
// - 保护：Haiku 改动范围变大/要跑危险命令时交给 Sonnet；本轮连续失败当场升档；
//         降档要连续确认；窗口装不下不切；计划模式用 Opus，批准计划后执行改用 Sonnet
// - /route 查看和手动控制
import type { EngineInterface, Register } from 'claude-code'
import {
  DEFAULTS, NAMES, ORDER, classifierPrompt, classifierSystem, guardDowngrade, guardHysteresis, guardWindow,
  isHandback, isRisky, mergeConfig, parseClassifier, ruleDecide, subagentTier, tierOf, up,
} from './rules'
import type { Config, Decision, Effort, Tier } from './rules'
import { msgs } from './i18n'
import type { Messages } from './i18n'

type Mode = 'auto' | 'off' | Tier
/** midTurn / handback: flags for the dashboard (the prompt markers are localized, so don't match on them) */
type Flags = { midTurn?: true; handback?: true }
type Logged = Decision & Flags & { at: number; prompt: string; model: string }
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
/** current UI messages (cfg.lang, fallback en) */
const M = (): Messages => msgs(cfg)
const modeStatus = (): string => (mode === 'off' ? M().statusOff : mode === 'auto' ? M().statusAuto : M().statusPinned(NAMES[mode]))
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
      description: M().cmdDescription,
      argumentHint: '[auto|off|haiku|sonnet|opus|fable|rules]',
      immediate: true,
    })
    $.ui.status(modeStatus())
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
        ? { tier: t, effort: prev?.tier === t ? prev.effort : cfg.effort[t], reason: M().handbackKeep, source: 'continue' }
        : { tier: t, effort: cfg.effort[t], reason: M().handbackUse(NAMES[t]), source: 'continue' }
      let tok = 0
      try { tok = (await $.session.usage()).context.tokens ?? 0 } catch { tok = 0 }
      d = guardWindow(d, cur, tok, cfg)
      mainTurn = e.turnId
      loops.set('main', { files: new Set(), errors: 0, escalated: false })
      byTurn.set(e.turnId, d)
      current = d.tier
      history.push({ ...d, at: Date.now(), prompt: M().markHandback, model: cfg.models[d.tier], handback: true })
      if (history.length > 30) history.shift()
      void writeLog($)
      return next(e)
    }
    if (mode !== 'auto') {
      d = { tier: mode, effort: cfg.effort[mode], reason: M().pinned, source: 'pin' }
    } else {
      d = ruleDecide(e.text, current, lastTurnErrors, cfg)
      if (d?.source !== 'manual' && permissionMode === 'plan') {
        d = { tier: cfg.planTier, effort: 'high', reason: M().planMode(NAMES[cfg.planTier], NAMES[cfg.executeTier]), source: 'rule', phase: 'plan' }
      } else if (d?.source !== 'manual' && lastWasPlan) {
        // 你退出计划模式后发的第一句（比如"执行"）：按计划执行，换执行档
        const t = cfg.executeTier
        d = { tier: t, effort: cfg.effort[t], reason: M().planSet(NAMES[t]), source: 'phase' }
      }
      if (!d) {
        const r = await $.model.complete({
          model: cfg.classifierModel,
          system: classifierSystem(cfg.lang),
          prompt: classifierPrompt(e.text, current),
          maxTokens: 120,
          effort: 'low',
          timeoutMs: cfg.classifierTimeoutMs,
        })
        d = r.isAnswered ? parseClassifier(r.text, cfg) : undefined
        if (!d) d = { tier: cfg.defaultTier, effort: cfg.effort[cfg.defaultTier], reason: M().fallback, source: 'fallback' }
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
        $.ui.log(M().subLog(type, label(s)))
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
      $.ui.toast(M().advisor(advisorCalls))
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
          escalate($, key, to, M().tooManyFiles(cfg.haikuGuard.maxFiles, NAMES[to]))
          return { deny: M().denyFiles(NAMES[to], file) }
        }
      }
      if (tool === 'Bash' && isRisky(String(input.command ?? ''), cfg)) {
        escalate($, key, to, M().risky(NAMES[to]))
        return { deny: M().denyRisky(short(String(input.command ?? ''), 60), NAMES[to]) }
      }
    }

    const r = await next(e)
    const denied = !!r && typeof r === 'object' && 'deny' in r && !!(r as { deny?: string }).deny
    const failed = !!r && typeof r === 'object' && 'isError' in r && (r as { isError?: boolean }).isError === true
    if (failed) {
      loop.errors++
      if (!loop.escalated && loop.errors >= cfg.midTurnEscalateAfterErrors && tier && tier !== 'fable') {
        const to = up(tier, cfg)
        if (to !== tier) escalate($, key, to, M().midTurnFails(loop.errors))
      }
    }

    // 计划模式里批准了计划：这一轮剩下的执行工作换成执行档
    if (tool === 'ExitPlanMode' && !failed && !denied && !e.agentId && mainTurn) {
      const d = byTurn.get(mainTurn)
      if (d?.phase === 'plan' && d.tier !== cfg.executeTier) {
        const t = cfg.executeTier
        adopt($, mainTurn, { tier: t, effort: cfg.effort[t], reason: M().planApproved(NAMES[t]), source: 'rule' }, M().markPlanApproved)
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
      $.ui.status(modeStatus())
      void writeLog($)
      const said =
        mode === 'auto' ? M().saidAuto
        : mode === 'off' ? M().saidOff
        : M().saidPinned(NAMES[mode])
      return { text: said + M().saidRemembered }
    }
    if (arg === 'rules') return { text: rulesText() }
    return { text: statusText() }
  })
}

/** 定下（或改变）主会话这一轮的档：记录、状态栏、换档提示、看板日志 */
function adopt($: EngineInterface, turnId: string, d: Decision, prompt: string, flags: Flags = {}) {
  const before = current
  byTurn.set(turnId, d)
  if (byTurn.size > 50) byTurn.delete(byTurn.keys().next().value as string)
  current = d.tier
  $.ui.status(`⇄ ${label(d)} — ${d.reason}`)
  if (before !== undefined && before !== d.tier) $.ui.toast(M().switched(NAMES[before], NAMES[d.tier], d.reason))
  history.push({ ...d, ...flags, at: Date.now(), prompt, model: cfg.models[d.tier] })
  if (history.length > 30) history.shift()
  void writeLog($)
}

/** 本轮内当场升档：主会话改这一轮剩下的请求；子代理改它之后的请求 */
function escalate($: EngineInterface, key: string, to: Tier, reason: string) {
  const loop = loopOf(key)
  loop.escalated = true
  if (key === 'main') {
    if (mainTurn) adopt($, mainTurn, { tier: to, effort: to === 'haiku' ? cfg.effort.haiku : 'high', reason, source: 'escalate' }, M().markMidTurn, { midTurn: true })
    return
  }
  const s = bySub.get(key)
  if (s) {
    bySub.set(key, { ...s, tier: to, effort: cfg.subagentEffort[to] })
    $.ui.toast(M().subSwitched(s.type, NAMES[s.tier], NAMES[to], reason))
    void writeLog($)
  }
}

function statusText(): string {
  const m = M()
  const head = mode === 'auto' ? m.headAuto : mode === 'off' ? m.headOff : m.headPinned(NAMES[mode])
  const now = current ? m.nowMain(NAMES[current]) : m.nowNone
  const wait = pendingDown ? m.waitDown(NAMES[pendingDown]) : ''
  const rows = history.slice(-10).reverse().map(h => {
    const t = new Date(h.at).toTimeString().slice(0, 5)
    return `  ${t}  ${NAMES[h.tier].padEnd(10)} ${h.effort.padEnd(6)} ${h.reason}  ${m.quote(h.prompt)}`
  })
  const subs = [...bySub.values()].slice(-6).map(s => `  ${s.type} → ${NAMES[s.tier]} · ${s.effort}`)
  return [
    head, now + wait, m.advisorCount(advisorCalls), '',
    m.recent, ...(rows.length ? rows : [m.none]),
    ...(subs.length ? ['', m.recentSubs, ...subs] : []),
    '', m.commands,
  ].join('\n')
}

function rulesText(): string {
  const m = M()
  const subs = Object.entries(cfg.subagents).map(([k, v]) => `${k}→${v === 'main' ? m.followMain : NAMES[v]}`).join(m.listSep)
  const k = (n: number) => `${Math.round(n / 1000)}k`
  return m.rules({
    escalateAfter: cfg.escalateAfterToolErrors,
    plan: NAMES[cfg.planTier],
    execute: NAMES[cfg.executeTier],
    bigTask: NAMES[cfg.bigTaskTier],
    opus: NAMES.opus,
    haiku: NAMES.haiku,
    defaultTier: NAMES[cfg.defaultTier],
    noDowngradeAbove: cfg.noDowngradeAboveTokens == null ? null : k(cfg.noDowngradeAboveTokens),
    confirmations: cfg.downgradeConfirmations,
    handback: cfg.handbackTier ? NAMES[cfg.handbackTier] : null,
    haikuWindow: k(cfg.windows.haiku ?? 0),
    midTurnAfter: cfg.midTurnEscalateAfterErrors,
    maxFiles: cfg.haikuGuard.maxFiles,
    guardTo: NAMES[cfg.haikuGuard.escalateTo],
    autoFable: cfg.autoFable,
    subs,
    subDefault: cfg.subagentDefault === 'main' ? m.followMain : NAMES[cfg.subagentDefault],
  }).join('\n')
}

async function writeLog($: EngineInterface) {
  if (!logFile) return
  try {
    await $.fs.write(logFile, JSON.stringify({ mode, lang: cfg.lang, current, pendingDown, advisorCalls, decisions: history, subagents: [...bySub.values()].slice(-20) }, null, 1))
  } catch {
    /* 看板没装也没关系 */
  }
}

export const _internal = { ORDER }

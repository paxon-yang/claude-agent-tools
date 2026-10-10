// auto-router：让 Claude Code 每一轮自动选模型
// - 你发出新任务时（turn.start）判断难度：先看关键词，拿不准再问 Haiku 5.5
// - 本轮发给模型的每个请求（turn.step）都改成选中的模型和 effort
// - 子代理按类型分配模型
// - 保护：Haiku 改动范围变大/要跑危险命令时交给 Sonnet；本轮连续失败当场升档；
//         降档要连续确认；窗口装不下不切；计划模式用 Opus，批准计划后执行改用 Sonnet
// - 提示缓存：当前模型缓存还热、换便宜模型这一轮省不回来时不换；状态栏显示缓存还剩多久
// - 测试关卡：便宜的模型改了代码，收工前先跑测试；没过就换 Opus 接着修
// - /route 查看和手动控制
import type { EngineInterface, Register } from 'claude-code'
import {
  DEFAULTS, NAMES, ORDER, classifierPrompt, classifierSystem, detectTestCommand, guardCache, guardDowngrade, guardHysteresis, guardWindow,
  isCodeFile, isHandback, isRisky, learnTtl, looksLikeTestRun, mergeConfig, mergePrices, parseClassifier, ruleDecide, shellArgv,
  subagentTier, tailOutput, tierOf, tierOfModel, up,
} from './rules'
import type { CacheView, Config, Decision, Effort, ProjectFiles, Tier } from './rules'
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

// 提示缓存：主会话每个模型的缓存热到什么时候；缓存时长（秒）先按 1 小时算，跑起来以后自己学
const warmUntil: Partial<Record<Tier, number>> = {}
const lastStepAt: Partial<Record<Tier, number>> = {}
let ttl = 3600
let stepsThisTurn = 0
const stepHist: number[] = [] // 最近几轮主会话每轮的请求次数
const outHist: number[] = [] // 最近的请求每次输出多少 token
let statusBase = ''

// 测试关卡：这一轮谁改了哪些代码文件、改完有没有自己跑过测试、拦了几次
type Gate = { edits: Map<string, Tier>; lastEditAt: number; lastTestOkAt: number; tries: number; lastRunAt: number; lastRunOk: boolean | null }
// 时间先后用递增的序号比较（不依赖时钟）/ ordering uses a counter, not the clock
let seq = 0
const newGate = (): Gate => ({ edits: new Map(), lastEditAt: 0, lastTestOkAt: 0, tries: 0, lastRunAt: 0, lastRunOk: null })
let gate: Gate = newGate()
let gateLog: { at: number; result: 'pass' | 'fail' | 'giveup' | 'skip' | 'timeout'; command?: string; by?: Tier; code?: number } | undefined
const avg = (xs: number[], d: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : d)

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
    // 看板装了就用看板的价格表，两边算出来的钱一致 / use the dashboard's prices when it is installed
    try {
      const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
      const viz = JSON.parse(String(await $.fs.read(`${home}/.claude/viz/app/config.json`))) as { prices?: unknown; port?: unknown }
      if (Number(viz.port) > 0) boardPort = Number(viz.port)
      cfg = { ...cfg, cache: { ...cfg.cache, prices: mergePrices(cfg.cache.prices, viz.prices) } }
    } catch {
      /* 没装看板 */
    }
    const learned = Number(await $.store.get('cacheTtl'))
    ttl = typeof cfg.cache.ttlSeconds === 'number' ? cfg.cache.ttlSeconds : learned === 300 || learned === 3600 ? learned : 3600
    $.clock.every(30000, () => renderStatus($))
    await $.command.register({
      name: 'route',
      description: M().cmdDescription,
      argumentHint: '[auto|off|haiku|sonnet|opus|fable|rules]',
      immediate: true,
    })
    setStatus($, modeStatus())
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
      // 汇总换便宜一档也要看缓存：Opus 缓存还热时，让 Sonnet 重读整段对话反而更贵
      d = guardCache(d, cur, cacheView(tok), cfg, lastEffort(cur))
      d = guardWindow(d, cur, tok, cfg)
      mainTurn = e.turnId
      loops.set('main', { files: new Set(), errors: 0, escalated: false })
      gate = newGate()
      stepsThisTurn = 0
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
      if (current) d = guardCache(d, current, cacheView(tokens), cfg, lastEffort(current))
      const h = guardHysteresis(d, current, pendingDown, cfg)
      d = h.decision
      pendingDown = h.pending
      d = guardWindow(d, current, tokens, cfg)
    }
    lastWasPlan = d.phase === 'plan'
    await $.store.set(`plan:${sid}`, lastWasPlan)
    mainTurn = e.turnId
    loops.set('main', { files: new Set(), errors: 0, escalated: false })
    gate = newGate()
    stepsThisTurn = 0
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
    noteCache($, result.usage, d.tier)
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
    if (mode === 'off') return next(e)
    if (mode !== 'auto') return trackForGate(e, await next(e))
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
    return trackForGate(e, r)
  }).catch(($, e, next) => next(e))

  // 测试关卡：Claude 要收工时，如果这一轮有便宜的模型改了代码，先跑测试
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    if (r.block || mode === 'off') return r
    const block = await runGate($, String(e.cwd ?? ''))
    return block ? { ...r, block } : r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      lastTurnErrors = loops.get('main')?.errors ?? 0
      loops.delete('main')
      if (stepsThisTurn > 0) {
        stepHist.push(stepsThisTurn)
        if (stepHist.length > 8) stepHist.shift()
      }
      stepsThisTurn = 0
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
      setStatus($, modeStatus())
      void writeLog($)
      const said =
        mode === 'auto' ? M().saidAuto
        : mode === 'off' ? M().saidOff
        : M().saidPinned(NAMES[mode])
      return { text: said + M().saidRemembered }
    }
    if (arg === 'rules') return { text: rulesText() }
    return { text: await statusText($) }
  })
}

/** 定下（或改变）主会话这一轮的档：记录、状态栏、换档提示、看板日志 */
function adopt($: EngineInterface, turnId: string, d: Decision, prompt: string, flags: Flags = {}) {
  const before = current
  byTurn.set(turnId, d)
  if (byTurn.size > 50) byTurn.delete(byTurn.keys().next().value as string)
  current = d.tier
  setStatus($, `⇄ ${label(d)} — ${d.reason}`)
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

// ---------------------------------------------------------------------------
// 提示缓存 / prompt cache
// ---------------------------------------------------------------------------

let shortTtlVotes = 0

/** 主会话每次请求后：记下这个模型的缓存热到什么时候，并从命中情况推算缓存时长 */
function noteCache($: EngineInterface, u: { model: string; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null | undefined, fallback: Tier) {
  if (!u) return
  const t = tierOfModel(u.model) ?? fallback
  const now = Date.now()
  const prev = lastStepAt[t]
  if (cfg.cache.ttlSeconds === 'auto' && prev) {
    const l = learnTtl((now - prev) / 1000, u)
    // 1 小时：一次命中就能证明；5 分钟：要连续两次（压缩对话也会让缓存全部失效，别误判）
    if (l === 300) shortTtlVotes++
    if (l === 3600) shortTtlVotes = 0
    const next = l === 3600 ? 3600 : l === 300 && shortTtlVotes >= 2 ? 300 : undefined
    if (next && next !== ttl) {
      ttl = next
      void $.store.set('cacheTtl', ttl)
    }
  }
  lastStepAt[t] = now
  warmUntil[t] = now + ttl * 1000
  stepsThisTurn++
  outHist.push(u.output_tokens || 0)
  if (outHist.length > 30) outHist.shift()
}

function cacheView(tokens: number): CacheView {
  return {
    now: Date.now(),
    tokens,
    warmUntil,
    ttlSeconds: ttl,
    steps: Math.max(1, Math.round(avg(stepHist, 5))),
    outPerStep: avg(outHist.slice(-20), 800),
  }
}

/** 这个模型最近一次用的 effort（留在它上面时不改 effort） */
function lastEffort(t: Tier | undefined): Effort | undefined {
  if (!t) return undefined
  for (let i = history.length - 1; i >= 0; i--) if (history[i].tier === t) return history[i].effort
  return undefined
}

function setStatus($: EngineInterface, text: string) {
  statusBase = text
  renderStatus($)
}

/** 状态栏：路由说明 + 当前模型的缓存还剩多久（每 30 秒刷新） */
function renderStatus($: EngineInterface) {
  let text = statusBase
  const until = current ? warmUntil[current] : undefined
  if (text && mode !== 'off' && cfg.cache.enabled && until) {
    const left = until - Date.now()
    text += ' · ' + (left > 0 ? M().cacheLeft(Math.ceil(left / 60000)) : M().cacheCold)
  }
  if (text) $.ui.status(text)
}

// ---------------------------------------------------------------------------
// 测试关卡 / test gate
// ---------------------------------------------------------------------------

let gateCmdCache: { cwd: string; cmd: string | undefined } | undefined
let warnedNoCmd = false

/** 工具调用结束后：记下谁改了哪个代码文件；模型自己跑测试通过了也记下 */
function trackForGate<R>(e: { tool: unknown; agentId?: string }, r: R): R {
  const failed = !!r && typeof r === 'object' && (('isError' in r && (r as { isError?: boolean }).isError === true) || ('deny' in r && !!(r as { deny?: string }).deny))
  if (failed) return r
  const tool = String(e.tool)
  const input = e as unknown as Record<string, unknown>
  if (EDIT_TOOLS.has(tool)) {
    const file = String(input.file_path ?? input.notebook_path ?? '')
    const tier = e.agentId ? bySub.get(e.agentId)?.tier : (mainTurn ? byTurn.get(mainTurn)?.tier : undefined) ?? current
    if (file && tier && isCodeFile(file)) {
      const before = gate.edits.get(file)
      // 同一个文件被几个模型改过：按最便宜的那个算
      if (!before || ORDER.indexOf(tier) < ORDER.indexOf(before)) gate.edits.set(file, tier)
      gate.lastEditAt = ++seq
    }
  } else if (tool === 'Bash' && gate.edits.size && looksLikeTestRun(String(input.command ?? ''), gateCmdCache?.cmd)) {
    gate.lastTestOkAt = ++seq
  }
  return r
}

async function readText($: EngineInterface, p: string): Promise<string | undefined> {
  try {
    return (await $.fs.exists(p)) ? String(await $.fs.read(p)) : undefined
  } catch {
    return undefined
  }
}
async function exists($: EngineInterface, p: string): Promise<boolean> {
  try {
    return await $.fs.exists(p)
  } catch {
    return false
  }
}

async function detectCommand($: EngineInterface, cwd: string): Promise<string | undefined> {
  if (gateCmdCache?.cwd === cwd) return gateCmdCache.cmd
  const j = (n: string) => `${cwd}/${n}`
  const f: ProjectFiles = {
    packageJson: await readText($, j('package.json')),
    pnpmLock: await exists($, j('pnpm-lock.yaml')),
    yarnLock: await exists($, j('yarn.lock')),
    bunLock: (await exists($, j('bun.lockb'))) || (await exists($, j('bun.lock'))),
    pyproject: await readText($, j('pyproject.toml')),
    pytestIni: await exists($, j('pytest.ini')),
    setupCfg: await readText($, j('setup.cfg')),
    toxIni: await exists($, j('tox.ini')),
    testsDir: (await exists($, j('tests'))) || (await exists($, j('test'))),
    cargoToml: await exists($, j('Cargo.toml')),
    goMod: await exists($, j('go.mod')),
    makefile: await readText($, j('Makefile')),
  }
  const cmd = detectTestCommand(f)
  gateCmdCache = { cwd, cmd }
  return cmd
}

/**
 * Claude 要收工时调用：这一轮有比 trustTier 便宜的模型改了代码、改完又没跑过测试，就跑一次。
 * 没通过：返回要交给模型的说明（拦下收工，让它接着修），并把这一轮换成 escalateTo。
 */
async function runGate($: EngineInterface, cwdIn: string): Promise<string | undefined> {
  const g = cfg.qualityGate
  if (!g.enabled || !gate.edits.size) return undefined
  const cheap = [...gate.edits.values()].filter(t => ORDER.indexOf(t) < ORDER.indexOf(g.trustTier))
  if (!cheap.length) return undefined
  if (gate.lastTestOkAt > gate.lastEditAt || gate.lastRunAt > gate.lastEditAt) return undefined
  const cwd = cwdIn || (await $.session.cwd())
  let proj: { testCommand?: unknown; qualityGate?: unknown } = {}
  try {
    proj = JSON.parse((await readText($, `${cwd}/.claude/auto-router.json`)) ?? '{}')
  } catch {
    proj = {}
  }
  if (proj.qualityGate === false) return undefined
  const cmd = (typeof proj.testCommand === 'string' && proj.testCommand.trim()) || g.command || (await detectCommand($, cwd))
  gate.lastRunAt = ++seq
  if (!cmd) {
    if (!warnedNoCmd) $.ui.toast(M().gateSkipNoCmd)
    warnedNoCmd = true
    return undefined
  }
  const who = cheap.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a))
  $.ui.toast(M().gateRunning(cmd))
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  let res: { exitCode: number; stdout: string; stderr: string }
  try {
    res = await $.process.run(shellArgv(cmd, windows), { cwd, timeoutMs: Math.min(600, Math.max(5, g.timeoutSec)) * 1000, env: { CI: '1' } })
  } catch {
    $.ui.toast(M().gateTimeout(g.timeoutSec))
    gateLog = { at: Date.now(), result: 'timeout', command: cmd, by: who }
    void writeLog($)
    return undefined
  }
  gate.lastRunAt = ++seq
  if (res.exitCode === 0) {
    gate.lastRunOk = true
    $.ui.toast(M().gatePass)
    gateLog = { at: Date.now(), result: 'pass', command: cmd, by: who }
    void writeLog($)
    return undefined
  }
  gate.lastRunOk = false
  if (gate.tries >= g.maxRetries) {
    $.ui.toast(M().gateGiveUp)
    gateLog = { at: Date.now(), result: 'giveup', command: cmd, by: who, code: res.exitCode }
    void writeLog($)
    return undefined
  }
  gate.tries++
  const to = g.escalateTo
  // 固定模型（/route haiku 之类）时不换模型，只让它接着修
  if (mode === 'auto' && current && ORDER.indexOf(current) < ORDER.indexOf(to)) escalate($, 'main', to, M().gateFailed(NAMES[to]))
  gateLog = { at: Date.now(), result: 'fail', command: cmd, by: who, code: res.exitCode }
  void writeLog($)
  return M().gateBlock(NAMES[who], cmd, res.exitCode, tailOutput(res.stdout, res.stderr))
}

/** 看板（agent-viz）里这个会话的数据：正在跑的子代理/后台任务、花费、远程地址。没装或没开就是 undefined */
type BoardAgent = { type: string; model?: string | null; status: string; description?: string | null }
type BoardBg = { tool: string; label?: string | null; description?: string | null; status: string }
type BoardSession = { id: string; agents?: BoardAgent[]; background?: BoardBg[]; usage?: { cost?: number; baseline?: number; saved?: number | null } }
type Board = { sessions?: BoardSession[]; totals?: { baselineModel?: string }; remote?: { urls?: string[]; public?: boolean; tailscale?: boolean } }
let boardPort = 4321

async function fetchBoard($: EngineInterface): Promise<Board | undefined> {
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${boardPort}/api/state`)
    return r.ok ? (JSON.parse(r.text) as Board) : undefined
  } catch {
    return undefined
  }
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
const usd = (x: number) => '$' + (x >= 10 ? x.toFixed(0) : x.toFixed(2))

/** /route：一张 Markdown 卡片（终端、桌面、手机 App 里都能显示） */
async function statusText($: EngineInterface): Promise<string> {
  const m = M()
  const head = mode === 'auto' ? m.headAuto : mode === 'off' ? m.headOff : m.headPinned(NAMES[mode])
  const lastD = history[history.length - 1]
  const nowLine = current
    ? `**${NAMES[current]}${lastD && lastD.tier === current ? ' · ' + lastD.effort : ''}**${lastD && lastD.tier === current ? ' — ' + lastD.reason : ''}`
    : m.nowNone
  const wait = pendingDown ? m.waitDown(NAMES[pendingDown]) : ''
  const until = current ? warmUntil[current] : undefined
  const cache = !cfg.cache.enabled ? m.routeCacheOff
    : current && until && until > Date.now() ? m.routeCache(NAMES[current], Math.ceil((until - Date.now()) / 60000), m.ttlLabel(ttl))
    : m.routeCacheNone(m.ttlLabel(ttl))
  const gateLine = !cfg.qualityGate.enabled ? m.routeGateOff : gateLog ? m.routeGate(gateLog.result, gateLog.command ?? '') : m.routeGateNone
  const out: string[] = [`### ⇄ ${head}`, '', nowLine + wait, '', `- ${cache}`, `- ${gateLine}`]
  if (advisorCalls) out.push(`- ${m.advisorCount(advisorCalls)}`)

  // 看板的数据：正在跑什么、花了多少 / from the dashboard: what is running, what it cost
  const board = await fetchBoard($)
  const sid = await $.session.id().catch(() => '')
  const bs = board?.sessions?.find(x => x.id === sid)
  if (bs) {
    const running = [
      ...(bs.agents ?? []).filter(a => a.status === 'running').map(a => `- ${a.type}${a.model ? ' → ' + a.model : ''}${a.description ? ' · ' + cell(a.description) : ''}`),
      ...(bs.background ?? []).filter(b => b.status === 'running').map(b => `- ${m.bgTask}${cell(b.description || b.label || b.tool)}`),
    ]
    out.push('', `**${m.runningNow(running.length)}**`, ...(running.length ? running : [`- ${m.nothingRunning}`]))
    const u = bs.usage
    if (u && typeof u.cost === 'number') {
      const base = String(board?.totals?.baselineModel ?? 'opus')
      const bt = tierOf(base)
      out.push('', m.sessionCost(usd(u.cost), u.saved == null ? null : Math.round(u.saved * 100), bt ? NAMES[bt] : base))
    }
    const url = board?.remote?.urls?.[0]
    if (url && (board?.remote?.public || board?.remote?.tailscale)) out.push('', `[${m.openBoard}](${url})`)
  } else {
    const subs = [...bySub.values()].slice(-6).map(x => `- ${x.type} → ${NAMES[x.tier]} · ${x.effort}`)
    if (subs.length) out.push('', `**${m.recentSubs}**`, ...subs)
  }

  const rows = history.slice(-8).reverse().map(h => {
    const t = new Date(h.at).toTimeString().slice(0, 5)
    return `| ${t} | ${NAMES[h.tier]} · ${h.effort} | ${cell(h.reason)} | ${cell(m.quote(h.prompt))} |`
  })
  out.push('', `**${m.recent}**`)
  if (rows.length) out.push('', `| ${m.colTime} | ${m.colModel} | ${m.colWhy} | ${m.colPrompt} |`, '|---|---|---|---|', ...rows)
  else out.push(m.none.trim())
  out.push('', '`' + m.commands.replace(/^[^:：]*[:：]\s*/, '') + '`')
  return out.join('\n')
}

/** 规则说明转成 Markdown：标题加粗，其余每条一行列表（Markdown 会把普通换行并成一段） */
function toMarkdown(lines: string[]): string {
  return lines.map(l => {
    const t = l.trim()
    if (!t) return ''
    if (/^\d+\.\s/.test(t)) return t
    if (/[:：]$/.test(t)) return `**${t}**`
    return '- ' + t.replace(/^·\s*/, '')
  }).join('\n').replace(/\n(\*\*[^\n]+\*\*)\n/g, '\n$1\n\n')
}

function rulesText(): string {
  const m = M()
  const subs = Object.entries(cfg.subagents).map(([k, v]) => `${k}→${v === 'main' ? m.followMain : NAMES[v]}`).join(m.listSep)
  const k = (n: number) => `${Math.round(n / 1000)}k`
  return toMarkdown(m.rules({
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
    cache: cfg.cache.enabled,
    cacheTtl: cfg.cache.ttlSeconds === 'auto' ? m.ttlAuto(m.ttlLabel(ttl)) : m.ttlLabel(cfg.cache.ttlSeconds),
    gate: cfg.qualityGate.enabled,
    gateBelow: ORDER.filter(t => ORDER.indexOf(t) < ORDER.indexOf(cfg.qualityGate.trustTier)).map(t => NAMES[t]).join(m.listSep),
    gateTo: NAMES[cfg.qualityGate.escalateTo],
    gateRetries: cfg.qualityGate.maxRetries,
  }))
}

async function writeLog($: EngineInterface) {
  if (!logFile) return
  try {
    await $.fs.write(logFile, JSON.stringify({
      mode, lang: cfg.lang, current, pendingDown, advisorCalls, decisions: history, subagents: [...bySub.values()].slice(-20),
      cache: { enabled: cfg.cache.enabled, ttl, warmUntil: { ...warmUntil } },
      gate: gateLog ?? null,
    }, null, 1))
  } catch {
    /* 看板没装也没关系 */
  }
}

export const _internal = { ORDER }

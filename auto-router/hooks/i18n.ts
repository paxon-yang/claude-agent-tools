// auto-router 的界面文字（中文 / English）。cfg.lang 选语言，默认 en。
// User-visible strings for the router, keyed by language. Selected by cfg.lang (fallback 'en').

export type Lang = 'en' | 'zh'

export const langOf = (l: unknown): Lang => (l === 'zh' ? 'zh' : 'en')

const zh = {
  // rules.ts — decision reasons
  manual: (tag: string) => `你指定了 #${tag}`,
  continueLast: '接着上一轮做',
  failedLastTurn: (n: number) => `上一轮失败 ${n} 次，升档`,
  frustration: '问题反复没解决，升档',
  hardest: '最难的任务',
  hardestNoFable: '最难的任务（Fable 需写 #fable）',
  bigTask: '多步骤大任务：主会话统筹，子代理分工',
  opusKind: '架构/重构/审查类',
  haikuKind: '提问/查找/小改动',
  classified: 'Haiku 判断',
  noDowngrade: (k: number) => `上下文 ${k}k，降档不划算，保持`,
  window: (k: number, want: string, use: string) => `对话 ${k}k，${want} 窗口不够，改用 ${use}`,
  holdDown: (reason: string, to: string) => `${reason}；先不降档，下一轮仍简单再换 ${to}`,
  cacheHold: (to: string, cur: string, k: number, usd: string, mins: number) =>
    `${cur} 缓存还热（剩 ${mins} 分钟）；换 ${to} 要重读 ${k}k 上下文，这一轮约多花 $${usd}，先不换`,
  cacheLeft: (mins: number) => `缓存剩 ${mins} 分`,
  cacheCold: '缓存已过期',
  gateRunning: (cmd: string) => `测试关卡：正在跑 ${cmd}`,
  gatePass: '测试关卡：测试通过 ✓',
  gateSkipNoCmd: '测试关卡：没找到测试命令，跳过（可在项目 .claude/auto-router.json 里写 "testCommand"）',
  gateTimeout: (s: number) => `测试关卡：测试超过 ${s} 秒没跑完，跳过`,
  gateFailed: (to: string) => `测试没通过，换 ${to} 接着修`,
  gateGiveUp: '测试关卡：测试仍没通过，交给你决定',
  gateBlock: (who: string, cmd: string, code: number, out: string) => [
    `auto-router 测试关卡：这一轮的代码是 ${who} 改的，收工前跑了 \`${cmd}\`，没有通过（退出码 ${code}）。`,
    '请找出原因并修好，然后再结束。如果这些失败在这一轮改动之前就存在、和这次改动无关，简单说明一下就可以结束。',
    '',
    '测试输出（最后一段）：',
    '```',
    out,
    '```',
  ].join('\n'),
  // classifier
  classifierReason: '<= 12 Chinese characters, in Chinese',
  reasonMax: 24,

  // register.ts
  cmdDescription: '自动选模型：查看状态，或 /route auto|off|haiku|sonnet|opus|fable|rules',
  statusOff: '⇄ 自动选模型：已关闭',
  statusAuto: '⇄ 自动选模型：待命',
  statusPinned: (name: string) => `⇄ 固定 ${name}`,
  handbackKeep: '子代理交回结果，沿用上一轮',
  handbackUse: (name: string) => `子代理交回结果，用 ${name} 汇总`,
  markHandback: '（子代理交回结果）',
  markMidTurn: '（本轮中途升档）',
  markPlanApproved: '（计划已批准）',
  pinned: '/route 固定',
  planMode: (plan: string, exec: string) => `计划模式：${plan} 想方案，批准后换 ${exec} 执行`,
  planSet: (name: string) => `计划已定，执行改用 ${name}`,
  planApproved: (name: string) => `计划已批准，执行改用 ${name}`,
  fallback: '判断失败，用默认档',
  subLog: (type: string, l: string) => `⇄ 子代理 ${type} → ${l}`,
  advisor: (n: number) => `顾问已介入（第 ${n} 次）`,
  tooManyFiles: (n: number, to: string) => `改动超过 ${n} 个文件，换 ${to} 接手`,
  denyFiles: (to: string, file: string) =>
    `auto-router：这个任务的改动范围比预想的大，已换成 ${to} 接手。之前的修改都保留，请从这一步（修改 ${file}）继续。`,
  risky: (to: string) => `要执行危险命令，换 ${to} 判断`,
  denyRisky: (cmd: string, to: string) => `auto-router：这条命令有风险（${cmd}），已换成 ${to} 接手。请重新判断是否真的需要执行。`,
  midTurnFails: (n: number) => `这一轮已失败 ${n} 次，当场升档`,
  switched: (from: string, to: string, reason: string) => `模型切换：${from} → ${to}（${reason}）`,
  subSwitched: (type: string, from: string, to: string, reason: string) => `子代理 ${type}：${from} → ${to}（${reason}）`,
  saidAuto: '已恢复自动选模型。',
  saidOff: '已关闭自动选模型，之后用 /model 里设的模型。',
  saidPinned: (name: string) => `已固定为 ${name}，每一轮都用它（子代理也是）。输入 /route auto 恢复自动。`,
  saidRemembered: '（这个选择会记住，下次打开 Claude Code 仍然有效）',

  // /route
  headAuto: '模式：自动',
  headOff: '模式：已关闭（/route auto 打开）',
  headPinned: (name: string) => `模式：固定 ${name}（/route auto 恢复自动）`,
  nowMain: (name: string) => `当前主会话：${name}`,
  nowNone: '当前主会话：还没开始',
  waitDown: (name: string) => `（等待确认：下一轮仍是简单任务就降到 ${name}）`,
  advisorCount: (n: number) => `顾问介入：${n} 次`,
  recent: '最近的选择（新的在上）：',
  none: '  （还没有）',
  recentSubs: '最近的子代理：',
  commands: '命令：/route auto | off | haiku | sonnet | opus | fable | rules',
  quote: (p: string) => `「${p}」`,
  ttlLabel: (sec: number) => (sec >= 3600 ? '1 小时' : `${Math.round(sec / 60)} 分钟`),
  ttlAuto: (l: string) => `自动识别，目前 ${l}`,
  routeCache: (name: string, mins: number, ttl: string) => `提示缓存：${name} 还剩 ${mins} 分钟（缓存时长 ${ttl}）`,
  routeCacheNone: (ttl: string) => `提示缓存：还没有热的缓存（缓存时长 ${ttl}）`,
  routeCacheOff: '提示缓存：不考虑（cache.enabled = false）',
  routeGate: (r: string, cmd: string) => `测试关卡：上次${({ pass: '通过', fail: '没通过，已让它接着修', giveup: '没通过，交给你了', skip: '跳过', timeout: '超时' } as Record<string, string>)[r] ?? r}${cmd ? `（${cmd}）` : ''}`,
  routeGateNone: '测试关卡：这次会话还没跑过',
  routeGateOff: '测试关卡：已关闭',
  bgTask: '后台：',
  runningNow: (n: number) => `正在跑（${n}）`,
  nothingRunning: '没有在跑的子代理或后台任务',
  sessionCost: (c: string, saved: number | null, base: string) => `这个会话花了 **${c}**${saved == null ? '' : ` · 比全用 ${base} 省 **${saved}%**`}`,
  openBoard: '打开完整看板',
  colTime: '时间', colModel: '模型', colWhy: '原因', colPrompt: '你说的',

  // /route rules
  followMain: '跟主会话',
  listSep: '，',
  rules: (r: RulesArgs) => [
    '自动选模型的规则（按顺序判断）：',
    '1. 提示里写了 #haiku / #sonnet / #opus / #fable → 用你指定的',
    '2. 只回了"继续/好的/ok"之类 → 沿用上一轮',
    `3. 上一轮工具失败 ≥ ${r.escalateAfter} 次，或你说"还是不对/又错了" → 升一档`,
    `4. 计划模式（Shift+Tab）→ ${r.plan} 想方案，批准计划后这一轮换 ${r.execute} 执行`,
    `5. 多步骤大任务（按文档/方案修改、@文档、很长、列了 4 条以上要求）→ 主会话 ${r.bigTask} 统筹`,
    `6. 提到架构、重构、迁移、安全、性能、审查等 → ${r.opus}`,
    `7. 提问、解释、查找、总结、翻译、改名等，且不要求改代码 → ${r.haiku}`,
    `8. 其他情况 → 让 ${r.haiku} 判断难度（失败时用 ${r.defaultTier}）`,
    '',
    '保护：',
    `· ${r.noDowngradeAbove == null ? '对话再长也允许降档' : `对话超过 ${r.noDowngradeAbove} 时不降档`}；降档要连续 ${r.confirmations} 轮都判成更便宜的档`,
    `· 后台子代理交回结果时，主会话用 ${r.handback ?? '上一轮的模型'} 汇总`,
    `· 对话超过目标模型窗口的八成时不切过去（Haiku 窗口按 ${r.haikuWindow} 算）`,
    `· 一轮里工具失败 ${r.midTurnAfter} 次 → 当场把这一轮剩下的请求升一档`,
    `· Haiku 一轮里改到第 ${r.maxFiles + 1} 个文件，或要执行危险命令 → 换 ${r.guardTo} 接手`,
    `· ${r.cache ? `提示缓存还热时，换便宜模型这一轮省不回来就不换（缓存按 ${r.cacheTtl} 算）` : '不考虑提示缓存（cache.enabled = false）'}`,
    `· ${r.gate ? `测试关卡：${r.gateBelow} 改了代码，收工前先跑测试，没过就换 ${r.gateTo} 接着修（每轮最多 ${r.gateRetries} 次）` : '测试关卡已关闭（qualityGate.enabled = false）'}`,
    '',
    `Fable 主力：${r.autoFable ? '最难任务、反复失败时自动启用' : '只在你写 #fable 时启用'}；顾问由 /advisor 设置，与这里无关`,
    `子代理：${r.subs}；其他类型 → ${r.subDefault}`,
    '改规则：编辑 ~/.claude/auto-router/config.json，然后重开 Claude Code',
  ],
}

export type RulesArgs = {
  escalateAfter: number
  plan: string
  execute: string
  bigTask: string
  opus: string
  haiku: string
  defaultTier: string
  noDowngradeAbove: string | null
  confirmations: number
  handback: string | null
  haikuWindow: string
  midTurnAfter: number
  maxFiles: number
  guardTo: string
  autoFable: boolean
  subs: string
  subDefault: string
  cache: boolean
  cacheTtl: string
  gate: boolean
  gateBelow: string
  gateTo: string
  gateRetries: number
}

export type Messages = typeof zh

const en: Messages = {
  manual: (tag: string) => `You chose #${tag}`,
  continueLast: 'Continuing last turn',
  failedLastTurn: (n: number) => `${n} failures last turn, stepping up`,
  frustration: 'Still unresolved, stepping up',
  hardest: 'Hardest task',
  hardestNoFable: 'Hardest task (Fable needs #fable)',
  bigTask: 'Multi-step task: main plans, sub-agents build',
  opusKind: 'Architecture/refactor/review',
  haikuKind: 'Question/lookup/small change',
  classified: 'Classified by Haiku',
  noDowngrade: (k: number) => `Context ${k}k, not worth downgrading`,
  window: (k: number, want: string, use: string) => `Context ${k}k too big for ${want}, using ${use}`,
  holdDown: (reason: string, to: string) => `${reason}; holding, ${to} next if still simple`,
  cacheHold: (to: string, cur: string, k: number, usd: string, mins: number) =>
    `${cur} cache is warm (${mins} min left); ${to} would re-read ${k}k tokens, ~$${usd} more this turn, staying`,
  cacheLeft: (mins: number) => `cache ${mins} min left`,
  cacheCold: 'cache expired',
  gateRunning: (cmd: string) => `Test gate: running ${cmd}`,
  gatePass: 'Test gate: tests pass ✓',
  gateSkipNoCmd: 'Test gate: no test command found, skipped (set "testCommand" in the project\'s .claude/auto-router.json)',
  gateTimeout: (s: number) => `Test gate: tests took over ${s}s, skipped`,
  gateFailed: (to: string) => `Tests failed, ${to} takes over to fix`,
  gateGiveUp: 'Test gate: tests still failing, leaving it to you',
  gateBlock: (who: string, cmd: string, code: number, out: string) => [
    `auto-router test gate: ${who} changed code this turn. Before finishing I ran \`${cmd}\` and it failed (exit code ${code}).`,
    'Please find the cause and fix it before you finish. If these failures existed before this turn and are unrelated to the change, say so briefly and stop.',
    '',
    'Test output (tail):',
    '```',
    out,
    '```',
  ].join('\n'),
  classifierReason: '<= 6 English words, in English',
  reasonMax: 40,

  cmdDescription: 'Auto model routing: show status, or /route auto|off|haiku|sonnet|opus|fable|rules',
  statusOff: '⇄ Auto model: off',
  statusAuto: '⇄ Auto model: ready',
  statusPinned: (name: string) => `⇄ Pinned to ${name}`,
  handbackKeep: 'Sub-agent hand-back, keeping model',
  handbackUse: (name: string) => `Sub-agent hand-back, ${name} summarizes`,
  markHandback: '(sub-agent hand-back)',
  markMidTurn: '(mid-turn escalation)',
  markPlanApproved: '(plan approved)',
  pinned: 'Pinned via /route',
  planMode: (plan: string, exec: string) => `Plan mode: ${plan} plans, ${exec} executes after approval`,
  planSet: (name: string) => `Plan set, executing with ${name}`,
  planApproved: (name: string) => `Plan approved, executing with ${name}`,
  fallback: 'Classifier failed, using default',
  subLog: (type: string, l: string) => `⇄ Sub-agent ${type} → ${l}`,
  advisor: (n: number) => `Advisor consulted (#${n})`,
  tooManyFiles: (n: number, to: string) => `Edits exceed ${n} files, ${to} takes over`,
  denyFiles: (to: string, file: string) =>
    `auto-router: this task touches more files than expected, so ${to} is taking over. Earlier edits are kept; please continue from this step (editing ${file}).`,
  risky: (to: string) => `Risky command, ${to} decides`,
  denyRisky: (cmd: string, to: string) => `auto-router: this command is risky (${cmd}), so ${to} is taking over. Please reconsider whether it really needs to run.`,
  midTurnFails: (n: number) => `${n} failures this turn, stepping up now`,
  switched: (from: string, to: string, reason: string) => `Model: ${from} → ${to} (${reason})`,
  subSwitched: (type: string, from: string, to: string, reason: string) => `Sub-agent ${type}: ${from} → ${to} (${reason})`,
  saidAuto: 'Automatic model routing is back on.',
  saidOff: 'Automatic model routing is off; the model set in /model will be used.',
  saidPinned: (name: string) => `Pinned to ${name} for every turn (sub-agents too). Type /route auto to go back to automatic.`,
  saidRemembered: ' (This choice is remembered the next time you open Claude Code.)',

  headAuto: 'Mode: automatic',
  headOff: 'Mode: off (/route auto to turn on)',
  headPinned: (name: string) => `Mode: pinned to ${name} (/route auto to go back to automatic)`,
  nowMain: (name: string) => `Main session now: ${name}`,
  nowNone: 'Main session now: not started yet',
  waitDown: (name: string) => ` (pending: drops to ${name} if the next turn is simple too)`,
  advisorCount: (n: number) => `Advisor consulted: ${n} times`,
  recent: 'Recent choices (newest first):',
  none: '  (none yet)',
  recentSubs: 'Recent sub-agents:',
  commands: 'Commands: /route auto | off | haiku | sonnet | opus | fable | rules',
  quote: (p: string) => `"${p}"`,
  ttlLabel: (sec: number) => (sec >= 3600 ? '1 hour' : `${Math.round(sec / 60)} minutes`),
  ttlAuto: (l: string) => `detected, currently ${l}`,
  routeCache: (name: string, mins: number, ttl: string) => `Prompt cache: ${name}, ${mins} min left (lifetime ${ttl})`,
  routeCacheNone: (ttl: string) => `Prompt cache: nothing warm yet (lifetime ${ttl})`,
  routeCacheOff: 'Prompt cache: ignored (cache.enabled = false)',
  routeGate: (r: string, cmd: string) => `Test gate: last run ${({ pass: 'passed', fail: 'failed, model is fixing it', giveup: 'failed, left to you', skip: 'skipped', timeout: 'timed out' } as Record<string, string>)[r] ?? r}${cmd ? ` (${cmd})` : ''}`,
  routeGateNone: 'Test gate: not run this session yet',
  routeGateOff: 'Test gate: off',
  bgTask: 'background: ',
  runningNow: (n: number) => `Running now (${n})`,
  nothingRunning: 'No sub-agents or background tasks running',
  sessionCost: (c: string, saved: number | null, base: string) => `This session cost **${c}**${saved == null ? '' : ` · **${saved}%** less than all-${base}`}`,
  openBoard: 'Open the full board',
  colTime: 'Time', colModel: 'Model', colWhy: 'Why', colPrompt: 'Prompt',

  followMain: 'same as main',
  listSep: ', ',
  rules: (r: RulesArgs) => [
    'Auto model routing rules (checked in order):',
    '1. Prompt contains #haiku / #sonnet / #opus / #fable → use that model',
    '2. Just "continue / ok / go ahead" → keep last turn\'s model',
    `3. ≥ ${r.escalateAfter} tool failures last turn, or you say "still failing / same error" → step up one tier`,
    `4. Plan mode (Shift+Tab) → ${r.plan} plans; once the plan is approved, ${r.execute} executes the rest of the turn`,
    `5. Multi-step task (follow a doc/spec/plan, @a doc, very long, 4+ listed requirements) → main session on ${r.bigTask} orchestrates`,
    `6. Mentions architecture, refactor, migration, security, performance, review, etc. → ${r.opus}`,
    `7. Questions, explanations, lookups, summaries, translation, renames, etc., with no code changes → ${r.haiku}`,
    `8. Anything else → ${r.haiku} rates the difficulty (falls back to ${r.defaultTier})`,
    '',
    'Safeguards:',
    `· ${r.noDowngradeAbove == null ? 'Downgrades allowed however long the conversation' : `No downgrades once the conversation exceeds ${r.noDowngradeAbove}`}; a downgrade needs ${r.confirmations} turns in a row rated cheaper`,
    `· When a background sub-agent hands back results, the main session summarizes with ${r.handback ?? 'last turn\'s model'}`,
    `· Never switch to a model whose window is over 80% full (Haiku window counted as ${r.haikuWindow})`,
    `· ${r.midTurnAfter} tool failures within a turn → step up the rest of that turn immediately`,
    `· Haiku editing a ${ordinal(r.maxFiles + 1)} file in one turn, or running a risky command → ${r.guardTo} takes over`,
    `· ${r.cache ? `While the prompt cache is warm, no downgrade that wouldn't pay for itself this turn (cache lifetime: ${r.cacheTtl})` : 'Prompt cache ignored (cache.enabled = false)'}`,
    `· ${r.gate ? `Test gate: when ${r.gateBelow} changed code, tests run before the turn ends; on failure ${r.gateTo} takes over to fix (at most ${r.gateRetries}× per turn)` : 'Test gate off (qualityGate.enabled = false)'}`,
    '',
    `Fable as main model: ${r.autoFable ? 'automatic for the hardest tasks and repeated failures' : 'only when you write #fable'}; the advisor is set with /advisor and is separate from this`,
    `Sub-agents: ${r.subs}; other types → ${r.subDefault}`,
    'To change the rules: edit ~/.claude/auto-router/config.json, then restart Claude Code',
  ],
}

/** 1st, 2nd, 3rd, 4th… (English only) */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

export const MESSAGES: Record<Lang, Messages> = { zh, en }

/** Messages for a config (or anything with a `lang` field). */
export const msgs = (c: { lang?: unknown } | undefined): Messages => MESSAGES[langOf(c?.lang)]

// 自动选模型的规则（纯函数，不碰 Claude Code，方便测试）
import { langOf, msgs } from './i18n'
import type { Lang } from './i18n'
export type { Lang } from './i18n'

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Source = 'manual' | 'pin' | 'continue' | 'escalate' | 'rule' | 'haiku' | 'fallback' | 'guard' | 'phase'

export type Decision = {
  tier: Tier
  effort: Effort
  reason: string
  source: Source
  /** plan = 计划模式里想方案；批准计划后这一轮换成 executeTier */
  phase?: 'plan'
}

export type Config = {
  /** UI language for reasons, status line and /route output: 'en' | 'zh' */
  lang: Lang
  models: Record<Tier, string>
  defaultTier: Tier
  effort: Record<Tier, Effort>
  autoFable: boolean
  classifierModel: string
  classifierTimeoutMs: number
  /** 上下文超过这个数就不往便宜的模型降；null = 不限制（默认）。换模型的一次性成本几次调用就能省回来 */
  noDowngradeAboveTokens: number | null
  /** 后台子代理交回结果时主会话用哪一档汇总；null = 沿用上一轮 */
  handbackTier: Tier | null
  escalateAfterToolErrors: number
  /** 本轮内工具失败达到这个次数，就当场把这一轮剩下的请求升一档 */
  midTurnEscalateAfterErrors: number
  /** 降档要连续几轮都判成更便宜的档才执行（1 = 立即降） */
  downgradeConfirmations: number
  /** 各模型的上下文窗口（token）；null = 不检查 */
  windows: Record<Tier, number | null>
  /** 多步骤大任务（按文档/方案修改等）主会话用的档 */
  bigTaskTier: Tier
  /** 计划模式里想方案用的档，以及批准计划后执行用的档 */
  planTier: Tier
  executeTier: Tier
  /** Haiku 的保护：一轮里最多改几个文件；超过、或要执行危险命令时换成 escalateTo */
  haikuGuard: { maxFiles: number; escalateTo: Tier; riskyCommands: string[] }
  subagents: Record<string, Tier | 'main'>
  subagentDefault: Tier | 'main'
  subagentEffort: Record<Tier, Effort>
  /**
   * 提示缓存：缓存只对同一个模型有效。换模型 = 新模型按"写缓存"价把整段对话重读一遍。
   * 缓存还热、这一轮又省不回来时，不往便宜的模型降。
   * Prompt cache is per model: switching re-reads the whole conversation at the cache-write price.
   * While the current model's cache is warm and the switch would not pay for itself this turn, don't downgrade.
   */
  cache: CacheConfig
  /** 测试关卡：便宜的模型改了代码，收工前先跑测试；没过就换 escalateTo 接着修 */
  qualityGate: GateConfig
  keywords: {
    haiku: string[]
    opus: string[]
    fable: string[]
    edit: string[]
    continue: string[]
    frustration: string[]
    bigTask: string[]
  }
}

export type Price = { in: number; out: number }
export type CacheConfig = {
  enabled: boolean
  /** 缓存多久过期（秒）；'auto' = 先按 1 小时算，再根据实际命中情况自己学 */
  ttlSeconds: number | 'auto'
  /** 换走以后再换回来时，当前模型缓存已过期的可能性（0–1）；null = 按缓存时长估（1 小时 0.1，5 分钟 0.5） */
  returnWeight: number | null
  /** 多花不到这么多美元就不拦 */
  minExtraUsd: number
  /** 每百万 token 的美元价（只看相对大小）；缓存读 = 输入价 × 0.1，写 = × 1.25（5 分钟）或 × 2（1 小时） */
  prices: Record<Tier, Price>
}
export type GateConfig = {
  enabled: boolean
  /** 测试命令；null = 自动识别（package.json 的 test、pytest、cargo、go、make test） */
  command: string | null
  /** 这一档及以上的模型改的代码不检查 */
  trustTier: Tier
  /** 测试没过时换哪一档接着修 */
  escalateTo: Tier
  timeoutSec: number
  /** 每一轮最多拦几次（防止原本就失败的测试让它一直修下去） */
  maxRetries: number
}

export const ORDER: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

export const NAMES: Record<Tier, string> = {
  haiku: 'Haiku 5.5',
  sonnet: 'Sonnet 5.5',
  opus: 'Opus 5.5',
  fable: 'Fable 5.1',
}

export const DEFAULTS: Config = {
  lang: 'en',
  models: {
    haiku: 'claude-haiku-5-5',
    sonnet: 'claude-sonnet-5-5',
    opus: 'claude-opus-5-5',
    fable: 'claude-fable-5-1',
  },
  defaultTier: 'sonnet',
  effort: { haiku: 'low', sonnet: 'medium', opus: 'high', fable: 'high' },
  autoFable: false,
  classifierModel: 'claude-haiku-5-5',
  classifierTimeoutMs: 6000,
  noDowngradeAboveTokens: null,
  handbackTier: 'sonnet',
  escalateAfterToolErrors: 3,
  midTurnEscalateAfterErrors: 3,
  downgradeConfirmations: 2,
  windows: { haiku: 200000, sonnet: null, opus: null, fable: null },
  bigTaskTier: 'opus',
  planTier: 'opus',
  executeTier: 'sonnet',
  haikuGuard: {
    maxFiles: 3,
    escalateTo: 'sonnet',
    riskyCommands: [
      'rm -rf', 'rm -r ', 'rm -fr', 'git push', 'git reset --hard', 'git clean', 'git rebase', 'git checkout -- ',
      'drop table', 'drop database', 'truncate table', 'delete from', 'migrate', 'migration', 'db push', 'db reset',
      'npm publish', 'pnpm publish', 'yarn publish', 'deploy', 'kubectl', 'terraform apply', 'docker rm', 'docker system prune',
      'chmod -r', 'chown -r', 'sudo ', 'mkfs', 'dd if=',
    ],
  },
  subagents: {
    explorer: 'haiku',
    researcher: 'haiku',
    Explore: 'haiku',
    'claude-code-guide': 'haiku',
    'statusline-setup': 'haiku',
    'quick-worker': 'sonnet',
    worker: 'sonnet',
    'general-purpose': 'sonnet',
    Plan: 'main',
  },
  subagentDefault: 'sonnet',
  subagentEffort: { haiku: 'low', sonnet: 'medium', opus: 'medium', fable: 'medium' },
  cache: {
    enabled: true,
    ttlSeconds: 'auto',
    returnWeight: null,
    minExtraUsd: 0.02,
    // 和看板 config.json 的默认价一致；看板装了会改用看板的价 / same defaults as the dashboard; its prices win when installed
    prices: {
      haiku: { in: 0.1, out: 0.5 },
      sonnet: { in: 2, out: 10 },
      opus: { in: 4, out: 20 },
      fable: { in: 10, out: 50 },
    },
  },
  qualityGate: {
    enabled: true,
    command: null,
    trustTier: 'opus',
    escalateTo: 'opus',
    timeoutSec: 180,
    maxRetries: 1,
  },
  keywords: {
    haiku: [
      '解释', '是什么', '什么意思', '在哪', '哪里', '找一下', '找找', '查一下', '列出', '看看',
      '总结', '概括', '翻译', '改名', '重命名', '错别字', '拼写', '格式化', '注释', '说明一下', '告诉我',
      // English: matched on word boundaries (with simple inflections), see has()
      'explain', 'what is', "what's", 'what are', 'what does', 'what do', 'where is', "where's", 'where are',
      'where do', 'which file', 'which files', 'how does', 'how do i', 'show me', 'tell me', 'describe',
      'find', 'look up', 'locate', 'search for', 'list', 'summarize', 'summarise', 'summary', 'tldr',
      'translate', 'rename', 'typo', 'spelling', 'format', 'comment', 'docstring', 'meaning of',
    ],
    opus: [
      '架构', '重构', '设计方案', '技术方案', '系统设计', '迁移', '升级框架', '安全', '漏洞', '性能优化',
      '并发', '死锁', '内存泄漏', '审查', 'review', '根本原因', '整个项目', '全部模块', '多个模块',
      '从零', '从头搭', '数据库设计', '表结构', '权限系统', '支付',
      'architecture', 'architectural', 'architect', 'refactor', 'redesign', 'restructure', 'rearchitect',
      'design doc', 'system design', 'technical design', 'migration', 'migrate', 'upgrade the framework',
      'framework upgrade', 'security', 'vulnerability', 'exploit', 'performance', 'concurrency',
      'race condition', 'deadlock', 'memory leak', 'code review', 'root cause', 'whole project',
      'entire project', 'whole codebase', 'entire codebase', 'across the codebase', 'all modules',
      'multiple modules', 'from scratch', 'schema', 'data model', 'permissions', 'permission system',
      'access control', 'payment', 'billing',
    ],
    fable: [
      '最难', '极难', '深度思考', '想透',
      'hardest', 'think very hard', 'think really hard', 'think deeply', 'think it through deeply',
      'extremely hard', 'extremely difficult', 'ultrathink',
    ],
    edit: [
      '修改', '改成', '改为', '实现', '添加', '增加', '新增', '删除', '重写', '修复', '修一下', '写一个',
      '写个', '做一个', '加上', '加个', '补上', '生成', '创建', '搭建', '部署',
      'fix', 'implement', 'add', 'create', 'build', 'write', 'rewrite', 'remove', 'delete', 'update',
      'change', 'modify', 'edit', 'replace', 'insert', 'append', 'patch', 'convert', 'make', 'set up',
      'setup', 'install', 'configure', 'wire up', 'deploy', 'generate',
    ],
    continue: [
      '继续', '好的', '好', '行', '可以', '是的', '对', '嗯', '没问题', '就这样', '照做', '开始吧', '做吧', '确认',
      'ok', 'okay', 'k', 'yes', 'yep', 'yeah', 'yup', 'sure', 'go', 'go on', 'go ahead', 'go for it',
      'continue', 'carry on', 'keep going', 'proceed', 'do it', 'do that', 'please do', 'sounds good',
      'looks good', 'lgtm', 'ship it', "let's go", "let's do it", 'approved', 'agreed', 'confirm',
      'confirmed', 'alright', 'all right', 'got it', 'that works', 'makes sense', 'great', 'perfect',
      'cool', 'fine', 'next',
    ],
    bigTask: [
      '按照文档', '按照这个文档', '按照我的文档', '根据文档', '根据这个文档', '照着文档', '按文档',
      '按照方案', '按照这个方案', '根据方案', '按这个方案', '按方案', '照着方案',
      '按照计划', '按计划', '按照需求', '根据需求文档', '按需求文档', '按照设计', '按照规范', '按照清单', '按照 prd', '根据 prd',
      'follow the plan', 'follow this plan', 'follow the spec', 'follow this spec', 'follow the doc',
      'follow this doc', 'follow the design doc', 'follow the prd', 'follow the requirements',
      'follow the checklist', 'according to the spec', 'according to the doc', 'according to the plan',
      'according to the design', 'according to the prd', 'according to the requirements',
      'implement the spec', 'implement this spec', 'implement the plan', 'implement this plan',
      'implement the design doc', 'execute the plan', 'based on the design doc', 'based on the spec',
      'based on the plan', 'per the plan', 'per the spec', 'per the doc', 'as described in the doc',
      'as specified in the spec',
    ],
    frustration: [
      '还是不对', '还是不行', '又错了', '还是报错', '又报错', '没解决', '不对啊', '还是失败', '又失败',
      'still failing', 'still fails', 'still broken', 'still not working', "still doesn't work",
      'still does not work', 'still wrong', 'still erroring', 'still getting', 'still the same',
      'same error', 'same issue', 'same problem', "didn't fix", 'did not fix', "didn't work",
      'did not work', "doesn't work either", 'not fixed', 'failed again', 'broken again', 'wrong again',
    ],
  },
}

export function mergeConfig(base: Config, over: unknown): Config {
  if (!over || typeof over !== 'object') return base
  const o = over as Partial<Config>
  return {
    ...base,
    ...o,
    lang: langOf(o.lang ?? base.lang),
    models: { ...base.models, ...(o.models ?? {}) },
    effort: { ...base.effort, ...(o.effort ?? {}) },
    subagents: { ...base.subagents, ...(o.subagents ?? {}) },
    subagentEffort: { ...base.subagentEffort, ...(o.subagentEffort ?? {}) },
    keywords: { ...base.keywords, ...(o.keywords ?? {}) },
    windows: { ...base.windows, ...(o.windows ?? {}) },
    haikuGuard: { ...base.haikuGuard, ...(o.haikuGuard ?? {}) },
    cache: {
      ...base.cache,
      ...(o.cache ?? {}),
      prices: mergePrices(base.cache.prices, (o.cache as Partial<CacheConfig> | undefined)?.prices),
    },
    qualityGate: { ...base.qualityGate, ...(o.qualityGate ?? {}) },
  }
}

/** 价格表合并：只认 haiku/sonnet/opus/fable 和数字的 in/out（看板的价格表也能直接传进来） */
export function mergePrices(base: Record<Tier, Price>, over: unknown): Record<Tier, Price> {
  const out = { ...base }
  if (!over || typeof over !== 'object') return out
  for (const t of ORDER) {
    const p = (over as Record<string, unknown>)[t] as Partial<Price> | undefined
    if (p && typeof p === 'object') {
      out[t] = {
        in: Number.isFinite(Number(p.in)) && Number(p.in) > 0 ? Number(p.in) : base[t].in,
        out: Number.isFinite(Number(p.out)) && Number(p.out) > 0 ? Number(p.out) : base[t].out,
      }
    }
  }
  return out
}

const ASCII = /^[\x00-\x7f]+$/
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** English normalisation: lower case, drop apostrophes ("what's" = "whats"), squeeze spaces */
const normEn = (s: string) => s.toLowerCase().replace(/['’‘]/g, '').replace(/\s+/g, ' ').trim()

/** Simple English inflections for the last word: fix → fixes/fixed/fixing, migrate → migration, format → formatting */
function inflect(w: string): string {
  if (w.length < 3 || !/[a-z]$/.test(w)) return esc(w)
  if (w.endsWith('e')) return esc(w.slice(0, -1)) + '(?:e|es|ed|er|ers|ing|ings|ion|ions)'
  if (/[^aeiou]y$/.test(w)) return esc(w.slice(0, -1)) + '(?:y|ies|ied|ying)'
  const last = w.slice(-1)
  const dbl = /[bcdfgklmnprstvz]/.test(last) ? `|${esc(last)}(?:ing|ed|er|ers)` : ''
  return esc(w) + `(?:s|es|ed|er|ers|ing|ings|ion|ions|ment|ments${dbl})?`
}

const reCache = new Map<string, RegExp>()
/** Word-boundary regex for an ASCII keyword, so "ok" ≠ "token" and "add" ≠ "address" */
function wordRe(w: string): RegExp {
  let re = reCache.get(w)
  if (!re) {
    const parts = normEn(w).split(' ')
    const body = [...parts.slice(0, -1).map(esc), inflect(parts[parts.length - 1])].join('\\s+')
    re = new RegExp(`(?<![a-z0-9_])${body}(?![a-z0-9_])`)
    if (reCache.size > 2000) reCache.clear()
    reCache.set(w, re)
  }
  return re
}

/**
 * 关键词匹配：含中文的词按子串匹配（原来的做法）；纯英文的词按单词边界匹配。
 * Keywords containing non-ASCII (Chinese) match as substrings; pure-ASCII keywords match whole words.
 */
export const has = (text: string, words: readonly string[]) => {
  const t = text.toLowerCase()
  let en: string | undefined
  return words.some(w => {
    if (!w || !w.trim()) return false
    if (!ASCII.test(w)) return t.includes(w.toLowerCase())
    en ??= normEn(text)
    return wordRe(w).test(en)
  })
}

/** English filler words that may surround a "continue" reply ("ok thanks", "yes please, go ahead") */
const FILLERS = ['please', 'pls', 'thanks', 'thank you', 'thx', 'ty', 'then', 'just', 'now', 'and', 'so', 'sir']

export const tierOf = (s: string | undefined): Tier | undefined => {
  const v = (s ?? '').toLowerCase().trim()
  return (ORDER as readonly string[]).includes(v) ? (v as Tier) : undefined
}

export const up = (t: Tier, cfg: Config): Tier =>
  t === 'haiku' ? 'sonnet' : t === 'sonnet' ? 'opus' : t === 'opus' && cfg.autoFable ? 'fable' : t === 'fable' ? 'fable' : 'opus'

/** 你在提示里亲手写的标记：#opus、#fable、用opus…… */
export function manualTag(text: string): Tier | undefined {
  const m = text.match(/(?:^|\s|[，,。])#(haiku|sonnet|opus|fable)\b/i) || text.match(/用\s*(haiku|sonnet|opus|fable)/i)
  return m ? tierOf(m[1]) : undefined
}

/** Claude Code 把后台子代理的结果当成一条消息送回主会话，这不是你发的新任务 */
export function isHandback(text: string): boolean {
  const t = String(text ?? '').trimStart()
  return t.startsWith('<agent-message') || t.startsWith('<task-notification') || t.includes('[Subagent hand-back]')
}

export function isContinue(text: string, cfg: Config): boolean {
  const t = text.trim().toLowerCase().replace(/[。.!！~～，,\s]+$/g, '')
  if (!t) return true
  // English reply: continue only if it is made up entirely of continue phrases and fillers
  if (ASCII.test(t)) {
    if (t.length > 60) return false
    let rest = ' ' + normEn(t).replace(/[^a-z0-9]+/g, ' ') + ' '
    if (!rest.trim()) return false
    const ws = [...cfg.keywords.continue, ...FILLERS]
      .filter(w => ASCII.test(w))
      .map(w => normEn(w).replace(/[^a-z0-9]+/g, ' ').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
    for (const w of ws) rest = rest.replace(new RegExp(`(?<= )${w.split(' ').map(esc).join(' +')}(?= )`, 'g'), ' ')
    return rest.trim() === ''
  }
  if (t.length > 12) return false
  return cfg.keywords.continue.some(w => {
    const k = w.toLowerCase()
    if (!k) return false
    if (t === k) return true
    if (!t.startsWith(k) || t.length > k.length + 4) return false
    // "ok了" yes, "okr" no: an ASCII keyword must not run into another letter
    return !ASCII.test(k) || !/[a-z0-9]/.test(t[k.length] ?? '')
  })
}

/**
 * 只用关键词就能确定的情况直接给答案；拿不准返回 undefined，交给 Haiku 判断。
 * prev = 上一轮主会话用的档；lastTurnErrors = 上一轮工具失败的次数。
 */
export function ruleDecide(text: string, prev: Tier | undefined, lastTurnErrors: number, cfg: Config): Decision | undefined {
  const e = (t: Tier): Effort => cfg.effort[t]
  const m = msgs(cfg)
  const tag = manualTag(text)
  if (tag) return { tier: tag, effort: e(tag), reason: m.manual(tag), source: 'manual' }

  if (prev && isContinue(text, cfg)) return { tier: prev, effort: e(prev), reason: m.continueLast, source: 'continue' }

  const base = prev ?? cfg.defaultTier
  if (lastTurnErrors >= cfg.escalateAfterToolErrors || has(text, cfg.keywords.frustration)) {
    const t = up(base === 'haiku' ? 'sonnet' : base, cfg)
    const why = lastTurnErrors >= cfg.escalateAfterToolErrors ? m.failedLastTurn(lastTurnErrors) : m.frustration
    return { tier: t, effort: t === 'haiku' ? 'medium' : 'high', reason: why, source: 'escalate' }
  }

  if (has(text, cfg.keywords.fable)) {
    return cfg.autoFable
      ? { tier: 'fable', effort: 'high', reason: m.hardest, source: 'rule' }
      : { tier: 'opus', effort: 'xhigh', reason: m.hardestNoFable, source: 'rule' }
  }
  if (isBigTask(text, cfg)) return { tier: cfg.bigTaskTier, effort: 'high', reason: m.bigTask, source: 'rule' }
  if (has(text, cfg.keywords.opus)) return { tier: 'opus', effort: e('opus'), reason: m.opusKind, source: 'rule' }

  if (has(text, cfg.keywords.haiku) && !has(text, cfg.keywords.edit) && text.length < 300) {
    // effort 跟着问题走：一句话的简单提问用 low，稍长、需要想一想的用 medium
    const eff: Effort = text.trim().length <= 40 ? 'low' : 'medium'
    return { tier: 'haiku', effort: eff, reason: m.haikuKind, source: 'rule' }
  }
  return undefined
}

/** 多步骤大任务：按文档/方案/计划修改、@了文档文件、很长、或列了 4 条以上要求 */
export function isBigTask(text: string, cfg: Config): boolean {
  if (has(text, cfg.keywords.bigTask)) return true
  if (/(按照|根据|照着|依照|按)\s*(我的|这个|这份|这篇|上面的?|下面的?|附件的?|我写的|我发的|刚才的?)*\s*(文档|方案|计划|需求|设计稿?|规范|清单|说明书|prd|spec)/i.test(text)) return true
  // English: "follow the spec", "implement the plan in…", "according to our design doc"
  if (/(?<![a-z])(follow|according to|per|implement|execute|based on|as (described|specified|outlined) in)\s+(the|this|my|our|that|these|your)\s+((attached|above|below|following|new|updated|written|technical|design)\s+)*(docs?|documents?|specs?|specification|plans?|prd|requirements?|rfc|checklist)(?![a-z])/i.test(text)) return true
  if (/@[\w./~-]+\.(md|markdown|docx?|pdf|txt|rst)\b/i.test(text)) return true
  if (/(按照|根据|照着|依照|按|follow|according to|implement|based on)\s*(the\s+)?[\w./~-]+\.(md|markdown|docx?|pdf|txt|rst)\b/i.test(text)) return true
  if (text.length > 800) return true
  const items = text.split('\n').filter(l => /^\s*(\d+[.、)）]|[-*•·])\s*\S/.test(l)).length
  return items >= 4
}

/** 危险命令：删除、强推、重置、迁移、删表、部署、发布…… */
export function isRisky(command: string, cfg: Config): boolean {
  const c = ' ' + command.toLowerCase().replace(/\s+/g, ' ') + ' '
  return cfg.haikuGuard.riskyCommands.some(w => c.includes(w.toLowerCase()))
}

export const classifierSystem = (lang: Lang) => [
  'You route requests sent to a coding assistant to the cheapest model tier that will do them well.',
  'haiku = questions, explanations, lookups, finding files, summaries, translation, renames, typo or formatting fixes, one-line edits.',
  'sonnet = normal work: implementing a feature, fixing an ordinary bug, writing tests, docs or scripts, edits across a few files.',
  'opus = architecture or design decisions, large refactors, changes across many modules, tricky debugging, security, performance, reviewing significant code.',
  'effort = how hard the model should think, chosen independently of tier (a haiku task can still be high):',
  'low = trivial or a pure lookup; medium = needs some reasoning or a small careful edit; high = subtle, easy to get wrong, or needs careful checking.',
  `Reply with one line of JSON only, no prose: {"tier":"haiku|sonnet|opus","effort":"low|medium|high","reason":"${msgs({ lang }).classifierReason}"}`,
].join('\n')

/** 旧名字保留（中文理由） / kept for compatibility: the Chinese-reason prompt */
export const CLASSIFIER_SYSTEM = classifierSystem('zh')

export function classifierPrompt(text: string, prev: Tier | undefined): string {
  const body = text.length > 3000 ? text.slice(0, 2000) + '\n…\n' + text.slice(-800) : text
  return `Previous tier: ${prev ?? 'none'}\nRequest:\n<<<\n${body}\n>>>`
}

export function parseClassifier(reply: string, cfg: Config): Decision | undefined {
  const m = reply.match(/\{[\s\S]*?\}/)
  if (!m) return undefined
  try {
    const o = JSON.parse(m[0]) as { tier?: string; effort?: string; reason?: string }
    const tier = tierOf(o.tier)
    if (!tier || tier === 'fable') return undefined
    const eff = (['low', 'medium', 'high'] as const).find(x => x === o.effort) ?? cfg.effort[tier]
    const effort: Effort = eff
    const ms = msgs(cfg)
    const r = String(o.reason ?? '').replace(/\s+/g, ' ').trim()
    const reason = r.length > ms.reasonMax ? r.slice(0, ms.reasonMax - 1).trimEnd() + '…' : r
    return { tier, effort, reason: reason || ms.classified, source: 'haiku' }
  } catch {
    return undefined
  }
}

/** 长对话里不往便宜的模型降：换模型要按未缓存价重读整段上下文 */
export function guardDowngrade(d: Decision, current: Tier | undefined, contextTokens: number, cfg: Config): Decision {
  if (!current || d.source === 'manual' || d.source === 'pin' || d.source === 'phase') return d
  if (ORDER.indexOf(d.tier) >= ORDER.indexOf(current)) return d
  if (cfg.noDowngradeAboveTokens == null || contextTokens <= cfg.noDowngradeAboveTokens) return d
  const k = Math.round(contextTokens / 1000)
  return { tier: current, effort: cfg.effort[current], reason: msgs(cfg).noDowngrade(k), source: 'guard' }
}

/** 窗口把关：对话快装不下目标模型时不切过去（装不下会被迫压缩，细节会丢） */
export function guardWindow(d: Decision, current: Tier | undefined, contextTokens: number, cfg: Config): Decision {
  const w = cfg.windows[d.tier]
  if (!w || contextTokens <= w * 0.8) return d
  const k = Math.round(contextTokens / 1000)
  const fallback = ORDER.find(t => ORDER.indexOf(t) > ORDER.indexOf(d.tier) && (!cfg.windows[t] || contextTokens <= (cfg.windows[t] as number) * 0.8)) ?? 'opus'
  const keep = current && ORDER.indexOf(current) > ORDER.indexOf(d.tier) && (!cfg.windows[current] || contextTokens <= (cfg.windows[current] as number) * 0.8) ? current : fallback
  return { tier: keep, effort: cfg.effort[keep], reason: msgs(cfg).window(k, NAMES[d.tier], NAMES[keep]), source: 'guard' }
}

/**
 * 降档要连续确认：这一轮想降，就先记下；下一轮还是想降（降到同档或更低）才真的降。
 * 返回最终决定，以及要记住的"待降档"。手动指定、固定、沿用、升档不受影响。
 */
export function guardHysteresis(d: Decision, current: Tier | undefined, pending: Tier | undefined, cfg: Config): { decision: Decision; pending: Tier | undefined } {
  const lower = current !== undefined && ORDER.indexOf(d.tier) < ORDER.indexOf(current)
  const soft = d.source === 'rule' || d.source === 'haiku' || d.source === 'fallback'
  if (!lower || !soft || cfg.downgradeConfirmations <= 1) return { decision: d, pending: undefined }
  if (pending !== undefined && ORDER.indexOf(d.tier) <= ORDER.indexOf(pending)) return { decision: d, pending: undefined }
  const keep = current as Tier
  return {
    decision: { tier: keep, effort: cfg.effort[keep], reason: msgs(cfg).holdDown(d.reason, NAMES[d.tier]), source: 'guard' },
    pending: d.tier,
  }
}

export function subagentTier(type: string, main: Tier | undefined, cfg: Config): Tier {
  const want = cfg.subagents[type] ?? cfg.subagentDefault
  if (want !== 'main') return want
  const m = main ?? cfg.defaultTier
  return m === 'haiku' ? 'sonnet' : m
}

// ---------------------------------------------------------------------------
// 提示缓存 / prompt cache
// ---------------------------------------------------------------------------

/** 换模型时要用到的现状：上下文多大、各档缓存热到什么时候、这一轮大概几步、每步输出多少 */
export type CacheView = {
  now: number
  /** 当前上下文 token 数 */
  tokens: number
  /** 各档主会话缓存的过期时间（毫秒时间戳） */
  warmUntil: Partial<Record<Tier, number>>
  /** 缓存时长（秒）：3600 或 300 */
  ttlSeconds: number
  /** 预计这一轮要发几次请求 */
  steps: number
  /** 每次请求大约输出多少 token */
  outPerStep: number
}

export const isWarm = (t: Tier, v: Pick<CacheView, 'now' | 'warmUntil'>) => (v.warmUntil[t] ?? 0) > v.now

/**
 * 这一轮留在 from 和换到 to 各要花多少（美元，估算）。
 * 第一次请求：缓存热按读价（输入 × 0.1），冷按写价（× 1.25，1 小时缓存 × 2）；之后每次都按读价。
 * 换走时还要算上"以后换回来、from 的缓存已经过期"要多写的那一次（乘以可能性）。
 */
export function switchCost(from: Tier, to: Tier, v: CacheView, cfg: Config): { stay: number; go: number; rewrite: number } {
  const C = v.tokens / 1e6
  const n = Math.max(1, v.steps)
  const wMult = v.ttlSeconds >= 3600 ? 2 : 1.25
  const p = (t: Tier) => cfg.cache.prices[t] ?? DEFAULTS.cache.prices[t]
  const r = (t: Tier) => p(t).in * 0.1
  const w = (t: Tier) => p(t).in * wMult
  const cost = (t: Tier) => C * (isWarm(t, v) ? r(t) : w(t)) + (n - 1) * C * r(t) + (n * v.outPerStep / 1e6) * p(t).out
  const q = cfg.cache.returnWeight ?? (v.ttlSeconds >= 3600 ? 0.1 : 0.5)
  const back = isWarm(from, v) ? q * C * (w(from) - r(from)) : 0
  return { stay: cost(from), go: cost(to) + back, rewrite: C * w(to) }
}

/** 这几类决定可以因为缓存改回去；你手动指定的、固定的、升档的、计划模式定的不动 */
const CACHE_SOFT: readonly Source[] = ['rule', 'haiku', 'fallback', 'continue']

/**
 * 缓存把关：当前模型的缓存还热、换到更便宜的模型这一轮反而更贵时，留在当前模型。
 * keepEffort = 当前模型上一轮的 effort（不改 effort，免得白白打断缓存）。
 */
export function guardCache(d: Decision, current: Tier | undefined, v: CacheView, cfg: Config, keepEffort?: Effort): Decision {
  if (!cfg.cache.enabled || !current || !CACHE_SOFT.includes(d.source)) return d
  if (ORDER.indexOf(d.tier) >= ORDER.indexOf(current)) return d
  if (!isWarm(current, v)) return d
  const c = switchCost(current, d.tier, v, cfg)
  const extra = c.go - c.stay
  if (extra <= cfg.cache.minExtraUsd) return d
  const m = msgs(cfg)
  const mins = Math.max(1, Math.round(((v.warmUntil[current] ?? v.now) - v.now) / 60000))
  return {
    tier: current,
    effort: keepEffort ?? cfg.effort[current],
    reason: m.cacheHold(NAMES[d.tier], NAMES[current], Math.round(v.tokens / 1000), money(extra), mins),
    source: 'guard',
  }
}

const money = (x: number) => (x >= 1 ? x.toFixed(2) : x >= 0.1 ? x.toFixed(2) : x.toFixed(3))

/**
 * 根据实际命中情况推算缓存时长：隔了 5 分钟以上还能大量命中 = 1 小时缓存；
 * 隔了 5 分钟到 1 小时、几乎没命中、却大量重写 = 5 分钟缓存。判断不了返回 undefined。
 */
export function learnTtl(gapSec: number, u: { cache_read_input_tokens: number; cache_creation_input_tokens: number }): 3600 | 300 | undefined {
  if (gapSec < 330 || gapSec > 3500) return undefined
  const read = u.cache_read_input_tokens || 0
  const wrote = u.cache_creation_input_tokens || 0
  if (read > 20000 && read > wrote * 4) return 3600
  if (wrote > 20000 && read < wrote / 20) return 300
  return undefined
}

/** 模型 id → 档 */
export function tierOfModel(model: string | undefined | null): Tier | undefined {
  const s = String(model ?? '').toLowerCase()
  if (s.includes('fable') || s.includes('mythos')) return 'fable'
  return ORDER.find(t => s.includes(t))
}

// ---------------------------------------------------------------------------
// 测试关卡 / test gate
// ---------------------------------------------------------------------------

/** 这些文件不算代码，只改了它们不跑测试 */
const NOT_CODE = /\.(md|markdown|mdx|txt|rst|adoc|csv|tsv|log|png|jpe?g|gif|webp|svg|ico|pdf|docx?|xlsx?|pptx?|lock)$/i
export const isCodeFile = (file: string) => !!file && !NOT_CODE.test(file) && !/(^|[\\/])(CHANGELOG|LICENSE|README)[^\\/]*$/i.test(file)

/** 项目里跟测试有关的文件内容（没有就 undefined），用来猜测试命令 */
export type ProjectFiles = {
  packageJson?: string
  pnpmLock?: boolean
  yarnLock?: boolean
  bunLock?: boolean
  pyproject?: string
  pytestIni?: boolean
  setupCfg?: string
  toxIni?: boolean
  testsDir?: boolean
  cargoToml?: boolean
  goMod?: boolean
  makefile?: string
}

/** 自动识别测试命令；认不出返回 undefined（那就不检查） */
export function detectTestCommand(f: ProjectFiles): string | undefined {
  if (f.packageJson) {
    try {
      const pkg = JSON.parse(f.packageJson) as { scripts?: Record<string, string> }
      const t = pkg.scripts?.test
      if (t && !/no test specified/i.test(t)) {
        if (f.pnpmLock) return 'pnpm test'
        if (f.yarnLock) return 'yarn test'
        if (f.bunLock) return 'bun run test'
        return 'npm test --silent'
      }
    } catch {
      /* package.json 写坏了就当没有 */
    }
  }
  if (f.cargoToml) return 'cargo test --quiet'
  if (f.goMod) return 'go test ./...'
  const py = (f.pyproject && /\[tool\.pytest|pytest/.test(f.pyproject)) || f.pytestIni || (f.setupCfg && /\[tool:pytest\]/.test(f.setupCfg)) || f.toxIni
  if (py || ((f.pyproject || f.setupCfg) && f.testsDir)) return 'python -m pytest -q -x'
  if (f.makefile && /^test\s*:/m.test(f.makefile)) return 'make test'
  return undefined
}

/** 这条 Bash 命令是不是在跑测试（模型自己跑过且通过了，就不用再跑一遍） */
export function looksLikeTestRun(command: string, testCmd?: string): boolean {
  const c = command.toLowerCase()
  if (testCmd && c.includes(testCmd.toLowerCase().replace(/\s+--silent$/, ''))) return true
  return /(^|[\s;&|(])(npm (run )?test|npm t|pnpm (run )?test|yarn (run )?test|bun (run )?test|npx (jest|vitest|mocha)|jest|vitest|mocha|pytest|python3? -m pytest|cargo test|go test|make (test|check)|deno test|node --test|rspec|phpunit|dotnet test|mvn test|gradle test|\.\/gradlew test)\b/.test(c)
}

/** 测试输出只留最后一段（失败信息通常在最后） */
export function tailOutput(stdout: string, stderr: string, max = 3000): string {
  const all = [stdout, stderr].map(s => String(s ?? '').trimEnd()).filter(Boolean).join('\n')
  return all.length > max ? '…\n' + all.slice(-max) : all
}

/** 在 shell 里跑一条命令行 */
export const shellArgv = (cmd: string, windows: boolean): string[] => (windows ? ['cmd', '/d', '/s', '/c', cmd] : ['sh', '-c', cmd])

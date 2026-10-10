// 自动选模型的规则（纯函数，不碰 Claude Code，方便测试）

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

export const ORDER: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

export const NAMES: Record<Tier, string> = {
  haiku: 'Haiku 5.5',
  sonnet: 'Sonnet 5.5',
  opus: 'Opus 5.5',
  fable: 'Fable 5.1',
}

export const DEFAULTS: Config = {
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
  keywords: {
    haiku: [
      '解释', '是什么', '什么意思', '在哪', '哪里', '找一下', '找找', '查一下', '列出', '看看',
      '总结', '概括', '翻译', '改名', '重命名', '错别字', '拼写', '格式化', '注释', '说明一下', '告诉我',
      'explain', 'what is', "what's", 'where is', 'where are', 'which file', 'list ', 'summarize',
      'summary', 'translate', 'rename', 'typo', 'format', 'how does', 'show me',
    ],
    opus: [
      '架构', '重构', '设计方案', '技术方案', '系统设计', '迁移', '升级框架', '安全', '漏洞', '性能优化',
      '并发', '死锁', '内存泄漏', '审查', 'review', '根本原因', '整个项目', '全部模块', '多个模块',
      '从零', '从头搭', '数据库设计', '表结构', '权限系统', '支付',
      'architecture', 'architect', 'refactor', 'redesign', 'migration', 'migrate', 'security',
      'vulnerability', 'performance', 'race condition', 'deadlock', 'memory leak', 'root cause',
      'code review', 'from scratch', 'schema design',
    ],
    fable: ['最难', '极难', '深度思考', '想透', 'hardest', 'think very hard', 'ultrathink'],
    edit: [
      '修改', '改成', '改为', '实现', '添加', '增加', '新增', '删除', '重写', '修复', '修一下', '写一个',
      '写个', '做一个', '加上', '加个', '补上', '生成', '创建', '搭建', '部署',
      'fix', 'implement', 'add ', 'create', 'build', 'write', 'remove', 'delete', 'update', 'change',
      'deploy', 'generate',
    ],
    continue: [
      '继续', '好的', '好', '行', '可以', '是的', '对', '嗯', '没问题', '就这样', '照做', '开始吧', '做吧', '确认',
      'ok', 'okay', 'yes', 'yep', 'sure', 'go', 'go on', 'continue', 'proceed', 'do it', 'sounds good',
    ],
    bigTask: [
      '按照文档', '按照这个文档', '按照我的文档', '根据文档', '根据这个文档', '照着文档', '按文档',
      '按照方案', '按照这个方案', '根据方案', '按这个方案', '按方案', '照着方案',
      '按照计划', '按计划', '按照需求', '根据需求文档', '按需求文档', '按照设计', '按照规范', '按照清单', '按照 prd', '根据 prd',
      'follow the plan', 'follow this plan', 'follow the spec', 'according to the spec', 'according to the doc',
      'implement the spec', 'implement this spec', 'based on the design doc', 'per the plan',
    ],
    frustration: [
      '还是不对', '还是不行', '又错了', '还是报错', '又报错', '没解决', '不对啊', '还是失败', '又失败',
      'still failing', 'still broken', 'still not working', 'same error', 'still wrong',
    ],
  },
}

export function mergeConfig(base: Config, over: unknown): Config {
  if (!over || typeof over !== 'object') return base
  const o = over as Partial<Config>
  return {
    ...base,
    ...o,
    models: { ...base.models, ...(o.models ?? {}) },
    effort: { ...base.effort, ...(o.effort ?? {}) },
    subagents: { ...base.subagents, ...(o.subagents ?? {}) },
    subagentEffort: { ...base.subagentEffort, ...(o.subagentEffort ?? {}) },
    keywords: { ...base.keywords, ...(o.keywords ?? {}) },
    windows: { ...base.windows, ...(o.windows ?? {}) },
    haikuGuard: { ...base.haikuGuard, ...(o.haikuGuard ?? {}) },
  }
}

const has = (text: string, words: readonly string[]) => {
  const t = text.toLowerCase()
  return words.some(w => w && t.includes(w.toLowerCase()))
}

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
  if (t.length > 12) return false
  return cfg.keywords.continue.some(w => t === w.toLowerCase() || (t.startsWith(w.toLowerCase()) && t.length <= w.length + 4))
}

/**
 * 只用关键词就能确定的情况直接给答案；拿不准返回 undefined，交给 Haiku 判断。
 * prev = 上一轮主会话用的档；lastTurnErrors = 上一轮工具失败的次数。
 */
export function ruleDecide(text: string, prev: Tier | undefined, lastTurnErrors: number, cfg: Config): Decision | undefined {
  const e = (t: Tier): Effort => cfg.effort[t]
  const tag = manualTag(text)
  if (tag) return { tier: tag, effort: e(tag), reason: `你指定了 #${tag}`, source: 'manual' }

  if (prev && isContinue(text, cfg)) return { tier: prev, effort: e(prev), reason: '接着上一轮做', source: 'continue' }

  const base = prev ?? cfg.defaultTier
  if (lastTurnErrors >= cfg.escalateAfterToolErrors || has(text, cfg.keywords.frustration)) {
    const t = up(base === 'haiku' ? 'sonnet' : base, cfg)
    const why = lastTurnErrors >= cfg.escalateAfterToolErrors ? `上一轮失败 ${lastTurnErrors} 次，升档` : '问题反复没解决，升档'
    return { tier: t, effort: t === 'haiku' ? 'medium' : 'high', reason: why, source: 'escalate' }
  }

  if (has(text, cfg.keywords.fable)) {
    return cfg.autoFable
      ? { tier: 'fable', effort: 'high', reason: '最难的任务', source: 'rule' }
      : { tier: 'opus', effort: 'xhigh', reason: '最难的任务（Fable 需写 #fable）', source: 'rule' }
  }
  if (isBigTask(text, cfg)) return { tier: cfg.bigTaskTier, effort: 'high', reason: '多步骤大任务：主会话统筹，子代理分工', source: 'rule' }
  if (has(text, cfg.keywords.opus)) return { tier: 'opus', effort: e('opus'), reason: '架构/重构/审查类', source: 'rule' }

  if (has(text, cfg.keywords.haiku) && !has(text, cfg.keywords.edit) && text.length < 300) {
    // effort 跟着问题走：一句话的简单提问用 low，稍长、需要想一想的用 medium
    const eff: Effort = text.trim().length <= 40 ? 'low' : 'medium'
    return { tier: 'haiku', effort: eff, reason: '提问/查找/小改动', source: 'rule' }
  }
  return undefined
}

/** 多步骤大任务：按文档/方案/计划修改、@了文档文件、很长、或列了 4 条以上要求 */
export function isBigTask(text: string, cfg: Config): boolean {
  if (has(text, cfg.keywords.bigTask)) return true
  if (/(按照|根据|照着|依照|按)\s*(我的|这个|这份|这篇|上面的?|下面的?|附件的?|我写的|我发的|刚才的?)*\s*(文档|方案|计划|需求|设计稿?|规范|清单|说明书|prd|spec)/i.test(text)) return true
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

export const CLASSIFIER_SYSTEM = [
  'You route requests sent to a coding assistant to the cheapest model tier that will do them well.',
  'haiku = questions, explanations, lookups, finding files, summaries, translation, renames, typo or formatting fixes, one-line edits.',
  'sonnet = normal work: implementing a feature, fixing an ordinary bug, writing tests, docs or scripts, edits across a few files.',
  'opus = architecture or design decisions, large refactors, changes across many modules, tricky debugging, security, performance, reviewing significant code.',
  'effort = how hard the model should think, chosen independently of tier (a haiku task can still be high):',
  'low = trivial or a pure lookup; medium = needs some reasoning or a small careful edit; high = subtle, easy to get wrong, or needs careful checking.',
  'Reply with one line of JSON only, no prose: {"tier":"haiku|sonnet|opus","effort":"low|medium|high","reason":"<= 12 Chinese characters"}',
].join('\n')

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
    return { tier, effort, reason: String(o.reason ?? '').slice(0, 24) || 'Haiku 判断', source: 'haiku' }
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
  return { tier: current, effort: cfg.effort[current], reason: `上下文 ${k}k，降档不划算，保持`, source: 'guard' }
}

/** 窗口把关：对话快装不下目标模型时不切过去（装不下会被迫压缩，细节会丢） */
export function guardWindow(d: Decision, current: Tier | undefined, contextTokens: number, cfg: Config): Decision {
  const w = cfg.windows[d.tier]
  if (!w || contextTokens <= w * 0.8) return d
  const k = Math.round(contextTokens / 1000)
  const fallback = ORDER.find(t => ORDER.indexOf(t) > ORDER.indexOf(d.tier) && (!cfg.windows[t] || contextTokens <= (cfg.windows[t] as number) * 0.8)) ?? 'opus'
  const keep = current && ORDER.indexOf(current) > ORDER.indexOf(d.tier) && (!cfg.windows[current] || contextTokens <= (cfg.windows[current] as number) * 0.8) ? current : fallback
  return { tier: keep, effort: cfg.effort[keep], reason: `对话 ${k}k，${NAMES[d.tier]} 窗口不够，改用 ${NAMES[keep]}`, source: 'guard' }
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
    decision: { tier: keep, effort: cfg.effort[keep], reason: `${d.reason}；先不降档，下一轮仍简单再换 ${NAMES[d.tier]}`, source: 'guard' },
    pending: d.tier,
  }
}

export function subagentTier(type: string, main: Tier | undefined, cfg: Config): Tier {
  const want = cfg.subagents[type] ?? cfg.subagentDefault
  if (want !== 'main') return want
  const m = main ?? cfg.defaultTier
  return m === 'haiku' ? 'sonnet' : m
}

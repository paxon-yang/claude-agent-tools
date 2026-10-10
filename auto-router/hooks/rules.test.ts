import { expect, test } from 'claude-code/testing'
import { DEFAULTS, guardDowngrade, parseClassifier, ruleDecide, subagentTier } from './rules'

const c = DEFAULTS
const tier = (t: string, prev?: 'haiku' | 'sonnet' | 'opus', errs = 0) => ruleDecide(t, prev, errs, c)?.tier

test('手动标记优先', () => {
  expect(tier('帮我看看这个函数 #opus')).toBe('opus')
  expect(tier('#fable 设计整个支付系统')).toBe('fable')
  expect(tier('用haiku总结一下')).toBe('haiku')
})

test('继续类回复沿用上一轮', () => {
  expect(tier('继续', 'opus')).toBe('opus')
  expect(tier('好的', 'haiku')).toBe('haiku')
  expect(tier('ok', 'sonnet')).toBe('sonnet')
  expect(tier('好的，把登录页改成飞书登录并补测试', 'haiku')).not.toBe('haiku')
})

test('反复失败升档', () => {
  expect(tier('再试试', 'sonnet', 3)).toBe('opus')
  expect(tier('还是不对', 'sonnet')).toBe('opus')
  expect(tier('还是不对', 'haiku')).toBe('opus')
})

test('关键词', () => {
  expect(tier('帮我重构整个认证模块')).toBe('opus')
  expect(tier('做一次 code review')).toBe('opus')
  expect(tier('解释一下 auth.ts 是干什么的')).toBe('haiku')
  expect(tier('登录逻辑在哪个文件')).toBe('haiku')
  expect(tier('解释一下然后修复这个 bug')).toBe(undefined)
  expect(tier('给月报 APP 加一个导出 PDF 的按钮')).toBe(undefined)
  expect(tier('这个问题要深度思考一下')).toBe('opus')
})

test('Haiku 判断结果的解析', () => {
  expect(parseClassifier('{"tier":"opus","effort":"high","reason":"多模块"}', c)?.tier).toBe('opus')
  expect(parseClassifier('好的 {"tier":"haiku","effort":"high","reason":"x"}', c)?.effort).toBe('high')
  expect(parseClassifier('{"tier":"fable"}', c)).toBe(undefined)
  expect(parseClassifier('不知道', c)).toBe(undefined)
})

test('长对话不降档（只在设置了上限时）', () => {
  const d = { tier: 'haiku' as const, effort: 'low' as const, reason: 'x', source: 'rule' as const }
  expect(guardDowngrade(d, 'opus', 900000, c).tier).toBe('haiku')
  const c2 = { ...c, noDowngradeAboveTokens: 80000 }
  expect(guardDowngrade(d, 'opus', 120000, c2).tier).toBe('opus')
  expect(guardDowngrade(d, 'opus', 20000, c).tier).toBe('haiku')
  expect(guardDowngrade({ ...d, source: 'manual' }, 'opus', 120000, c2).tier).toBe('haiku')
})

test('子代理分配', () => {
  expect(subagentTier('explorer', 'opus', c)).toBe('haiku')
  expect(subagentTier('worker', 'opus', c)).toBe('sonnet')
  expect(subagentTier('Plan', 'opus', c)).toBe('opus')
  expect(subagentTier('Plan', 'haiku', c)).toBe('sonnet')
  expect(subagentTier('something-new', 'opus', c)).toBe('sonnet')
})

import { guardHysteresis, guardWindow, isBigTask, isRisky } from './rules'

test('多步骤大任务', () => {
  expect(tier('按照我的这个文档来修改')).toBe('opus')
  expect(tier('请根据需求文档实现导出功能')).toBe('opus')
  expect(tier('照着 @docs/spec.md 改一下')).toBe('opus')
  expect(tier('按照 docs/spec.md 修改这个项目')).toBe('opus')
  expect(tier('implement docs/plan.md')).toBe('opus')
  expect(isBigTask('要求：\n1. 加登录\n2. 加导出\n3. 改首页\n4. 写测试', c)).toBe(true)
  expect(isBigTask('按照我说的把变量名改一下', c)).toBe(false)
  expect(tier('x'.repeat(900))).toBe('opus')
})

test('危险命令', () => {
  expect(isRisky('rm -rf build', c)).toBe(true)
  expect(isRisky('git push origin main', c)).toBe(true)
  expect(isRisky('npx prisma migrate dev', c)).toBe(true)
  expect(isRisky('npm test', c)).toBe(false)
  expect(isRisky('ls -la src', c)).toBe(false)
})

test('降档要连续两次确认', () => {
  const d = { tier: 'haiku' as const, effort: 'low' as const, reason: '提问', source: 'rule' as const }
  const first = guardHysteresis(d, 'opus', undefined, c)
  expect(first.decision.tier).toBe('opus')
  expect(first.pending).toBe('haiku')
  const second = guardHysteresis(d, 'opus', first.pending, c)
  expect(second.decision.tier).toBe('haiku')
  expect(second.pending).toBe(undefined)
  expect(guardHysteresis({ ...d, source: 'manual' }, 'opus', undefined, c).decision.tier).toBe('haiku')
  expect(guardHysteresis({ ...d, tier: 'opus' }, 'sonnet', undefined, c).decision.tier).toBe('opus')
})

test('窗口把关', () => {
  const d = { tier: 'haiku' as const, effort: 'low' as const, reason: 'x', source: 'manual' as const }
  expect(guardWindow(d, 'opus', 190000, c).tier).toBe('opus')
  expect(guardWindow(d, undefined, 190000, c).tier).toBe('sonnet')
  expect(guardWindow(d, 'opus', 50000, c).tier).toBe('haiku')
})

import { isHandback } from './rules'
test('子代理交回结果不算新任务', () => {
  expect(isHandback('<agent-message from="a8a68cde13e0e69a2"> [Subagent hand-back] The text below is the final report')).toBe(true)
  expect(isHandback('  <task-notification>done</task-notification>')).toBe(true)
  expect(isHandback('按照 docs/spec.md 修改')).toBe(false)
})

import { parseClassifier as pc, ruleDecide as rd, DEFAULTS as D } from './rules'
test('effort 跟着问题走', () => {
  expect(rd('解释一下 auth.ts', undefined, 0, D)?.effort).toBe('low')
  expect(rd('解释一下 auth.ts 里登录失败之后的重试逻辑，为什么第三次重试会跳过 token 刷新，和 session.ts 里的过期判断有什么关系，哪里会出问题', undefined, 0, D)?.effort).toBe('medium')
  expect(pc('{"tier":"haiku","effort":"high","reason":"细节容易错"}', D)?.effort).toBe('high')
})

// ---- English prompts / 英文提示 ----
import { has, isContinue, classifierSystem, mergeConfig } from './rules'
const zhCfg = mergeConfig(DEFAULTS, { lang: 'zh' })

test('English keywords route like the Chinese ones', () => {
  expect(tier('explain what auth.ts does')).toBe('haiku')
  expect(tier('Where is the login handler?')).toBe('haiku')
  expect(tier('summarize this file')).toBe('haiku')
  expect(tier('refactor the auth architecture')).toBe('opus')
  expect(tier('Refactoring the payments module')).toBe('opus')
  expect(tier('find the root cause of this deadlock')).toBe('opus')
  expect(tier('do a code review of the PR')).toBe('opus')
  expect(tier('ultrathink about this')).toBe('opus')
  expect(tier('explain the bug and then fix it')).toBe(undefined)
  expect(tier('add an export to PDF button')).toBe(undefined)
})

test('English multi-step tasks', () => {
  expect(tier('implement the spec in docs/plan.md')).toBe('opus')
  expect(tier('Follow the plan we wrote yesterday')).toBe('opus')
  expect(tier('please build it according to our design doc')).toBe('opus')
  expect(isBigTask('implement design changes on the button', c)).toBe(false)
})

test('English continue replies', () => {
  expect(tier('ok', 'opus')).toBe('opus')
  expect(tier('OK, go ahead!', 'haiku')).toBe('haiku')
  expect(tier('yes please', 'sonnet')).toBe('sonnet')
  expect(tier('Sounds good, thanks', 'opus')).toBe('opus')
  expect(tier('lgtm', 'opus')).toBe('opus')
  expect(tier("let's do it", 'opus')).toBe('opus')
  expect(isContinue('ok now add tests for the parser', c)).toBe(false)
  expect(isContinue('go fix it', c)).toBe(false)
  expect(isContinue('golang', c)).toBe(false)
  expect(isContinue('ok了', c)).toBe(true)
  expect(isContinue('okr', c)).toBe(false)
})

test('English "still failing" escalates', () => {
  expect(tier('still failing', 'sonnet')).toBe('opus')
  expect(tier("that didn't fix it", 'sonnet')).toBe('opus')
  expect(tier('Same error as before', 'haiku')).toBe('opus')
  expect(ruleDecide('still broken', 'sonnet', 0, c)?.source).toBe('escalate')
})

test('English words match on word boundaries', () => {
  expect(has('refresh the token', ['ok'])).toBe(false)
  expect(has('update the address field', ['add'])).toBe(false)
  expect(has('add a field', ['add'])).toBe(true)
  expect(has('added a field', ['add'])).toBe(true)
  expect(has('the preview pane', ['review'])).toBe(false)
  expect(has('reviewing the diff', ['review'])).toBe(true)
  expect(has('run the migrations', ['migrate'])).toBe(true)
  expect(has('fix the formatting', ['format'])).toBe(true)
  expect(has('information', ['format'])).toBe(false)
  expect(has("What’s this", ["what's"])).toBe(true)
  expect(has('帮我refactor一下', ['refactor'])).toBe(true)
  expect(has('按照 PRD 来', ['按照 prd'])).toBe(true)
  // 'list' must not fire inside other words
  expect(tier('check the playlist component')).toBe(undefined)
  expect(tier('where is the token stored')).toBe('haiku')
})

test('reasons follow cfg.lang', () => {
  expect(ruleDecide('explain auth.ts', undefined, 0, c)?.reason).toBe('Question/lookup/small change')
  expect(ruleDecide('explain auth.ts', undefined, 0, zhCfg)?.reason).toBe('提问/查找/小改动')
  expect(ruleDecide('继续', 'opus', 0, c)?.reason).toBe('Continuing last turn')
  expect(ruleDecide('继续', 'opus', 0, zhCfg)?.reason).toBe('接着上一轮做')
  expect(ruleDecide('x', 'sonnet', 3, c)?.reason).toBe('3 failures last turn, stepping up')
  expect(ruleDecide('x', 'sonnet', 3, zhCfg)?.reason).toBe('上一轮失败 3 次，升档')
  expect(parseClassifier('{"tier":"sonnet"}', c)?.reason).toBe('Classified by Haiku')
  expect(parseClassifier('{"tier":"sonnet"}', zhCfg)?.reason).toBe('Haiku 判断')
  expect((parseClassifier('{"tier":"sonnet","reason":"' + 'a'.repeat(80) + '"}', c)?.reason ?? '').length).toBe(40)
  const hd = { tier: 'haiku' as const, effort: 'low' as const, reason: 'Q', source: 'rule' as const }
  expect(guardHysteresis(hd, 'opus', undefined, zhCfg).decision.reason).toBe('Q；先不降档，下一轮仍简单再换 Haiku 5.5')
  expect(guardWindow(hd, 'opus', 190000, c).reason).toBe('Context 190k too big for Haiku 5.5, using Opus 5.5')
  expect(classifierSystem('en')).toContain('in English')
  expect(classifierSystem('zh')).toContain('Chinese')
  expect(mergeConfig(DEFAULTS, {}).lang).toBe('en')
  expect(mergeConfig(DEFAULTS, { lang: 'fr' }).lang).toBe('en')
})

// ---- 提示缓存 / prompt cache ----
import { guardCache, switchCost, learnTtl, tierOfModel, mergePrices } from './rules'
import type { CacheView } from './rules'
const NOW = 1_000_000_000
const view = (o: Partial<CacheView> = {}): CacheView => ({
  now: NOW, tokens: 150_000, warmUntil: { opus: NOW + 40 * 60_000 }, ttlSeconds: 3600, steps: 5, outPerStep: 800, ...o,
})
const down = (t: 'haiku' | 'sonnet', source: 'rule' | 'haiku' | 'continue' | 'manual' = 'haiku') => ({ tier: t, effort: 'low' as const, reason: 'x', source })

test('warm Opus cache: Opus → Sonnet in a long conversation is held', () => {
  const d = guardCache(down('sonnet'), 'opus', view(), c, 'high')
  expect(d.tier).toBe('opus')
  expect(d.effort).toBe('high')
  expect(d.source).toBe('guard')
  expect(d.reason).toContain('150k')
  expect(d.reason).toContain('40 min')
})

test('cache guard lets the switch through when it is cheap or the cache is cold', () => {
  // 冷缓存：换走不花额外的钱 / cold cache: switching costs nothing extra
  expect(guardCache(down('sonnet'), 'opus', view({ warmUntil: { opus: NOW - 1 } }), c).tier).toBe('sonnet')
  // 很短的对话：多花的钱低于门槛 / tiny context: below the threshold
  expect(guardCache(down('sonnet'), 'opus', view({ tokens: 3000 }), c).tier).toBe('sonnet')
  // Haiku 便宜得多，重写缓存也比 Opus 读缓存便宜 / Haiku's write is cheaper than Opus's read here
  expect(guardCache(down('haiku'), 'opus', view(), c).tier).toBe('haiku')
  // 很长的一轮：便宜模型每步省下的钱能补回来 / long turn: savings per step pay it back
  expect(guardCache(down('sonnet'), 'opus', view({ steps: 60 }), c).tier).toBe('sonnet')
})

test('cache guard never blocks upgrades, manual choices or pins', () => {
  expect(guardCache({ tier: 'opus', effort: 'high', reason: 'x', source: 'rule' }, 'sonnet', view({ warmUntil: { sonnet: NOW + 1e6 } }), c).tier).toBe('opus')
  expect(guardCache(down('sonnet', 'manual'), 'opus', view(), c).tier).toBe('sonnet')
  expect(guardCache({ ...down('sonnet'), source: 'pin' }, 'opus', view(), c).tier).toBe('sonnet')
  expect(guardCache(down('sonnet'), 'opus', view(), { ...c, cache: { ...c.cache, enabled: false } }).tier).toBe('sonnet')
  // 子代理交回结果（source continue）也要看缓存 / hand-backs count too
  expect(guardCache(down('sonnet', 'continue'), 'opus', view(), c).tier).toBe('opus')
})

test('switch cost arithmetic', () => {
  // 1M tokens, 1 step, no output: Opus warm read 0.4 vs Sonnet 1h write 2×2 = 4, plus 0.1 × (8 − 0.4) return risk
  const r = switchCost('opus', 'sonnet', view({ tokens: 1_000_000, steps: 1, outPerStep: 0 }), c)
  expect(Math.round(r.stay * 100) / 100).toBe(0.4)
  expect(Math.round(r.go * 100) / 100).toBe(4.76)
  // 5-minute cache: write 2 × 1.25 = 2.5, return risk 0.5 × (4 × 1.25 − 0.4) = 2.3
  const s = switchCost('opus', 'sonnet', view({ tokens: 1_000_000, steps: 1, outPerStep: 0, ttlSeconds: 300 }), c)
  expect(Math.round(s.go * 100) / 100).toBe(4.8)
})

test('cache lifetime is learned from real hits', () => {
  expect(learnTtl(900, { cache_read_input_tokens: 120_000, cache_creation_input_tokens: 2_000 })).toBe(3600)
  expect(learnTtl(900, { cache_read_input_tokens: 0, cache_creation_input_tokens: 120_000 })).toBe(300)
  expect(learnTtl(60, { cache_read_input_tokens: 0, cache_creation_input_tokens: 120_000 })).toBe(undefined)
  expect(learnTtl(900, { cache_read_input_tokens: 5_000, cache_creation_input_tokens: 4_000 })).toBe(undefined)
})

test('model ids and dashboard prices', () => {
  expect(tierOfModel('claude-opus-5-5')).toBe('opus')
  expect(tierOfModel('claude-mythos-5-1')).toBe('fable')
  expect(tierOfModel('gpt-x')).toBe(undefined)
  const p = mergePrices(c.cache.prices, { opus: { in: 5, out: 25, cacheRead: 0.5 }, mythos: { in: 1 }, sonnet: { in: 'x' } })
  expect(p.opus.in).toBe(5)
  expect(p.sonnet.in).toBe(2)
  expect(mergeConfig(DEFAULTS, { cache: { minExtraUsd: 1 } }).cache.prices.opus.in).toBe(4)
})

// ---- 测试关卡 / test gate ----
import { detectTestCommand, isCodeFile, looksLikeTestRun, tailOutput, shellArgv } from './rules'

test('test command detection', () => {
  expect(detectTestCommand({ packageJson: '{"scripts":{"test":"vitest run"}}' })).toBe('npm test --silent')
  expect(detectTestCommand({ packageJson: '{"scripts":{"test":"jest"}}', pnpmLock: true })).toBe('pnpm test')
  expect(detectTestCommand({ packageJson: '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })).toBe(undefined)
  expect(detectTestCommand({ pyproject: '[tool.pytest.ini_options]\naddopts = "-q"' })).toBe('python -m pytest -q -x')
  expect(detectTestCommand({ pyproject: '[project]\nname="x"', testsDir: true })).toBe('python -m pytest -q -x')
  expect(detectTestCommand({ cargoToml: true })).toBe('cargo test --quiet')
  expect(detectTestCommand({ goMod: true })).toBe('go test ./...')
  expect(detectTestCommand({ makefile: 'build:\n\tcc x.c\ntest: build\n\t./run' })).toBe('make test')
  expect(detectTestCommand({ packageJson: '{nope' })).toBe(undefined)
  expect(detectTestCommand({})).toBe(undefined)
})

test('which edits count as code', () => {
  expect(isCodeFile('/p/src/app.ts')).toBe(true)
  expect(isCodeFile('/p/config.json')).toBe(true)
  expect(isCodeFile('/p/README.md')).toBe(false)
  expect(isCodeFile('/p/docs/guide.mdx')).toBe(false)
  expect(isCodeFile('C:\\p\\CHANGELOG')).toBe(false)
  expect(isCodeFile('/p/notes.txt')).toBe(false)
})

test('recognises a test run in Bash', () => {
  expect(looksLikeTestRun('cd web && npm test')).toBe(true)
  expect(looksLikeTestRun('pytest -q tests/test_api.py')).toBe(true)
  expect(looksLikeTestRun('npx vitest run src')).toBe(true)
  expect(looksLikeTestRun('cargo test -p core')).toBe(true)
  expect(looksLikeTestRun('./scripts/check.sh', './scripts/check.sh')).toBe(true)
  expect(looksLikeTestRun('npm install')).toBe(false)
  expect(looksLikeTestRun('cat latest.txt')).toBe(false)
  expect(looksLikeTestRun('git commit -m "test"')).toBe(false)
})

test('test output tail and shell', () => {
  expect(tailOutput('a'.repeat(5000), 'FAIL x', 100).endsWith('FAIL x')).toBe(true)
  expect(tailOutput('ok', '', 100)).toBe('ok')
  expect(shellArgv('npm test', false)).toEqual(['sh', '-c', 'npm test'])
  expect(shellArgv('npm test', true)[0]).toBe('cmd')
})

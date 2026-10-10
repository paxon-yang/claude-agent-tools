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

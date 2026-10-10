// 测试关卡的端到端测试：引擎的 $ 由测试代替（文件、命令、模型都是假的）
// End-to-end test of the test gate against the engine's own hook chain (files, commands and models are mocked)
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type World = { files: Record<string, string>; exit: number; runs: { argv: readonly string[]; cwd?: string }[]; log?: string }

function world(on: On, w: World) {
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  w.files['/home/u/.claude/viz'] = ''
  mock.clock(on, { now: 1_000_000 })
  const v = <T>(value: T) => ({ value })
  on('fs.read', ($, e) => (e.path in w.files ? v(w.files[e.path]) : { deny: 'ENOENT ' + e.path }))
  on('fs.exists', ($, e) => v(e.path in w.files))
  on('fs.write', ($, e) => {
    if (e.path.includes('/router/')) w.log = e.text
    return v(undefined)
  })
  on('session.id', () => v('sess-1'))
  on('session.cwd', () => v('/proj'))
  on('session.usage', () => v({ startedAt: 0, context: { tokens: 20_000, window: 1_000_000 }, rateLimits: [] }))
  on('agent.list', () => v([]))
  on('command.register', ($, e) => v({ command: e.name }))
  on('ui.status', () => v(undefined))
  on('ui.toast', () => v(undefined))
  on('ui.log', () => v(undefined))
  on('model.complete', () => v({ isAnswered: true as const, text: '{"tier":"haiku","effort":"low","reason":"x"}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }))
  on('process.run', ($, e) => {
    w.runs.push({ argv: e.argv, cwd: e.init?.cwd })
    return v({ exitCode: w.exit, stdout: w.exit ? 'FAIL src/auth.test.ts\n  expected 2, got 3' : 'all good', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.Stop', () => ({}))
  on('tool.call', () => ({ result: 'ok' }))
}

const PKG = { '/proj/package.json': '{"scripts":{"test":"vitest run"}}' }

test('Haiku edits code, tests fail → finishing is blocked once and the model is told why', async ($, on) => {
  const w: World = { files: { ...PKG }, exit: 1, runs: [] }
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })
  await $.turn.start({ text: 'explain auth.ts', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' } as never)

  const first = await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })
  expect(w.runs.length).toBe(1)
  expect(w.runs[0].argv).toEqual(['sh', '-c', 'npm test --silent'])
  expect(w.runs[0].cwd).toBe('/proj')
  expect(first.block ?? '').toContain('FAIL src/auth.test.ts')
  expect(first.block ?? '').toContain('Haiku')
  // 这一轮剩下的请求换成 Opus；看板日志里记下关卡结果 / the rest of the turn runs on Opus; the dashboard log records it
  const log = JSON.parse(w.log ?? '{}')
  expect(log.current).toBe('opus')
  expect(log.gate.result).toBe('fail')
  expect(log.decisions[log.decisions.length - 1].source).toBe('escalate')

  // 模型没再改代码就要收工（比如说明这是原本就有的失败）：不再跑、不再拦
  const second = await $.classic.Stop({ stop_hook_active: true, cwd: '/proj' })
  expect(second.block).toBe(undefined)
  expect(w.runs.length).toBe(1)
})

test('a second failure after the fix attempt is left to you, not looped', async ($, on) => {
  const w: World = { files: { ...PKG }, exit: 1, runs: [] }
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })
  await $.turn.start({ text: 'explain auth.ts', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })).block).toBeTruthy()
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'b', new_string: 'c' } as never)
  expect((await $.classic.Stop({ stop_hook_active: true, cwd: '/proj' })).block).toBe(undefined)
  expect(w.runs.length).toBe(2)
})

test('passing tests, docs-only edits, a test run the model already did, or no test command → never blocked', async ($, on) => {
  const w: World = { files: { ...PKG }, exit: 0, runs: [] }
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })

  await $.turn.start({ text: 'explain auth.ts', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })).block).toBe(undefined)
  expect(w.runs.length).toBe(1)

  w.exit = 1
  await $.turn.start({ text: 'explain the readme', turnId: 't2' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/README.md', old_string: 'a', new_string: 'b' } as never)
  expect((await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })).block).toBe(undefined)
  expect(w.runs.length).toBe(1)

  await $.turn.start({ text: 'explain auth.ts again', turnId: 't3' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'b', new_string: 'c' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run src/auth.test.ts' } as never)
  expect((await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })).block).toBe(undefined)
  expect(w.runs.length).toBe(1)
})

test('project opt-out and Opus-only edits skip the gate', async ($, on) => {
  const w: World = { files: { ...PKG, '/proj/.claude/auto-router.json': '{"qualityGate": false}' }, exit: 1, runs: [] }
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })
  await $.turn.start({ text: 'explain auth.ts', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'a', new_string: 'b' } as never)
  expect((await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })).block).toBe(undefined)

  delete w.files['/proj/.claude/auto-router.json']
  await $.turn.start({ text: 'refactor the auth architecture #opus', turnId: 't2' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/auth.ts', old_string: 'b', new_string: 'c' } as never)
  expect((await $.classic.Stop({ stop_hook_active: false, cwd: '/proj' })).block).toBe(undefined)
  expect(w.runs.length).toBe(0)
})

// ---- /route：手机 App 里也能看的卡片 / a card that also renders in the Claude mobile app ----
test('/route is a Markdown card with what the dashboard knows', async ($, on) => {
  const w: World = { files: { ...PKG }, exit: 1, runs: [] }
  world(on, w)
  on('http.fetch', () => ({
    value: {
      status: 200, ok: true, headers: {},
      text: JSON.stringify({
        sessions: [{
          id: 'sess-1',
          agents: [{ type: 'explorer', model: 'Haiku 5.5', status: 'running', description: 'read | auth module' }, { type: 'worker', status: 'done' }],
          background: [{ tool: 'Bash', description: 'npm run dev', status: 'running' }],
          usage: { cost: 1.234, baseline: 2, saved: 0.383 },
        }],
        totals: { baselineModel: 'opus' },
        remote: { urls: ['https://board.example.com'], public: true },
      }),
    },
  }))
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })
  await $.turn.start({ text: 'explain auth.ts', turnId: 't1' })
  const r = await $.command.run({ command: 'route', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const text = r.text ?? ''
  expect(text).toContain('### ⇄ Mode: automatic')
  expect(text).toContain('**Haiku 5.5 · low**')
  expect(text).toContain('Running now (2)')
  expect(text).toContain('explorer → Haiku 5.5 · read \\| auth module')
  expect(text).toContain('background: npm run dev')
  expect(text).toContain('This session cost **$1.23** · **38%** less than all-Opus 5.5')
  expect(text).toContain('[Open the full board](https://board.example.com)')
  expect(text).toContain('| Time | Model | Why | Prompt |')
  expect(text).toContain('Test gate: not run this session yet')
  const rules = (await $.command.run({ command: 'route', args: 'rules', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text ?? ''
  expect(rules).toContain('**Safeguards:**')
  expect(rules).toContain('- While the prompt cache is warm')
  expect(rules).toContain('1. Prompt contains #haiku')
})

test('/route works without the dashboard', async ($, on) => {
  const w: World = { files: { ...PKG }, exit: 1, runs: [] }
  world(on, w)
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: true })
  const r = await $.command.run({ command: 'route', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r.text ?? '').toContain('Main session now: not started yet')
  expect(r.text ?? '').toContain('(none yet)')
})

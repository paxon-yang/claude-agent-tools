'use strict';
// Builds a small fake home folder for report.js tests, with timestamps relative to "now".
// Usage from tests: const { buildHome } = require('./fixtures/build-home'); buildHome(dir)
// Usage by hand:    node agent-viz/test/fixtures/build-home.js /tmp/fake-home
//                   node agent-viz/report.js --home /tmp/fake-home
const fs = require('fs');
const path = require('path');

const S1 = '11111111-aaaa-4aaa-8aaa-000000000001'; // routed by auto-router, project shop-api
const S2 = '22222222-bbbb-4bbb-8bbb-000000000002'; // not routed, project shop-api
const S3 = '33333333-cccc-4ccc-8ccc-000000000003'; // not routed, project blog-site
const S4 = '44444444-dddd-4ddd-8ddd-000000000004'; // old file (mtime 30 days ago)

const PROJ_A = '-Users-alice-work-shop-api';
const PROJ_B = '-home-bob-projects-blog-site';
const CWD_A = '/Users/alice/work/shop-api';
const CWD_B = '/home/bob/projects/blog-site';

const usage = (i, o, cr, cw) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
function asst({ id, model, u, ts, session, cwd, sidechain }) {
  const e = { type: 'assistant', timestamp: new Date(ts).toISOString(), uuid: 'u-' + id + '-' + Math.random().toString(36).slice(2, 8),
    isSidechain: !!sidechain, cwd, message: { id, model, role: 'assistant', usage: u } };
  if (session) e.sessionId = session;
  return JSON.stringify(e);
}
const user = (ts, session, cwd) => JSON.stringify({ type: 'user', timestamp: new Date(ts).toISOString(), sessionId: session, cwd, message: { role: 'user', content: 'hi' } });

function write(file, lines) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, lines.join('\n') + '\n'); }

function buildHome(home, now = Date.now()) {
  const H = h => now - h * 3600e3;
  const P = path.join(home, '.claude', 'projects');

  // ---- project A / session S1 (routed) ----
  write(path.join(P, PROJ_A, S1 + '.jsonl'), [
    user(H(5), S1, CWD_A),
    // a1 streamed in two chunks: only the LAST usage counts
    asst({ id: 'msg_a1', model: 'claude-haiku-4-5', u: usage(10, 5, 0, 0), ts: H(5), session: S1, cwd: CWD_A }),
    asst({ id: 'msg_a1', model: 'claude-haiku-4-5', u: usage(100000, 50000, 1000000, 200000), ts: H(5), session: S1, cwd: CWD_A }),
    '{"type":"assistant","message":{"usage": broken json',
    asst({ id: 'msg_a2', model: 'claude-sonnet-4-6', u: usage(200000, 100000, 2000000, 0), ts: H(4), session: S1, cwd: CWD_A }),
    asst({ id: 'msg_syn', model: '<synthetic>', u: usage(999999, 999999, 0, 0), ts: H(4), session: S1, cwd: CWD_A }),
  ]);
  // sub-agent transcript (new layout): <project>/<session>/subagents/agent-*.jsonl
  write(path.join(P, PROJ_A, S1, 'subagents', 'agent-abc123.jsonl'), [
    asst({ id: 'msg_a3', model: 'claude-haiku-4-5', u: usage(50000, 20000, 500000, 0), ts: H(4), session: S1, cwd: CWD_A, sidechain: true }),
  ]);

  // ---- project A / session S2 (not routed): one line without sessionId -> taken from file name ----
  write(path.join(P, PROJ_A, S2 + '.jsonl'), [
    asst({ id: 'msg_b0', model: 'claude-opus-5-5', u: usage(7000000, 7000000, 0, 0), ts: now - 10 * 86400e3, session: S2, cwd: CWD_A }), // older than window
    asst({ id: 'msg_b1', model: 'claude-opus-5-5', u: usage(300000, 150000, 3000000, 400000), ts: H(30), session: null, cwd: CWD_A }),
  ]);

  // ---- project B / session S3 (not routed) ----
  write(path.join(P, PROJ_B, S3 + '.jsonl'), [
    user(H(50), S3, CWD_B),
    asst({ id: 'msg_c1', model: 'claude-opus-5-5', u: usage(100000, 80000, 0, 0), ts: H(50), session: S3, cwd: CWD_B }),
    asst({ id: 'msg_c9', model: 'claude-unknown-1', u: usage(5000, 5000, 0, 0), ts: H(49), session: S3, cwd: CWD_B }),
  ]);
  // sub-agent transcript (old layout): <project>/agent-*.jsonl carrying the parent sessionId
  write(path.join(P, PROJ_B, 'agent-xyz789.jsonl'), [
    asst({ id: 'msg_c2', model: 'claude-haiku-4-5', u: usage(40000, 10000, 0, 0), ts: H(49), session: S3, cwd: CWD_B, sidechain: true }),
  ]);

  // ---- old transcript, skipped by mtime ----
  const old = path.join(P, PROJ_B, S4 + '.jsonl');
  write(old, [asst({ id: 'msg_d1', model: 'claude-opus-5-5', u: usage(1e6, 1e6, 0, 0), ts: now - 30 * 86400e3, session: S4, cwd: CWD_B })]);
  const oldSec = (now - 30 * 86400e3) / 1000;
  fs.utimesSync(old, oldSec, oldSec);

  // ---- auto-router note for S1 ----
  write(path.join(home, '.claude', 'viz', 'router', S1 + '.json'), [JSON.stringify({ session: S1, decisions: [] })]);

  // ---- dashboard price config (only haiku given: others fall back to defaults) ----
  write(path.join(home, '.claude', 'viz', 'app', 'config.json'), [JSON.stringify({ prices: { haiku: { in: 0.1, out: 0.5 } }, baselineModel: 'opus' })]);
  return { S1, S2, S3, S4, CWD_A, CWD_B };
}

module.exports = { buildHome, S1, S2, S3, S4 };
if (require.main === module) {
  // Without an argument this does nothing, so test runners that execute every file
  // under test/ (Node 18/20 directory mode) don't fail on it.
  const dir = process.argv[2];
  if (dir) { buildHome(path.resolve(dir)); console.log('fake home written to ' + path.resolve(dir)); }
}

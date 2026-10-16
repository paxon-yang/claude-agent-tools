'use strict';
// Run: node --test agent-viz/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { baselineUsage, fillBaselines } = require('../baseline');

const H = 3600e3;

test('a switch rewrite counts as cache reads in the baseline', () => {
  // Opus read 100k from cache; then Sonnet had to write the whole 100k + 2k new
  const prev = { ts: 0, ctx: 100000 };
  const b = baselineUsage({ in: 10, out: 500, cr: 0, cw: 102000 }, prev, 60e3);
  assert.deepStrictEqual([b.cr, b.cw], [99990, 2010]);
});

test('normal incremental writes, compaction and expiry are left alone', () => {
  const u = { in: 10, out: 500, cr: 100000, cw: 2000 };
  assert.strictEqual(baselineUsage(u, { ts: 0, ctx: 100000 }, 60e3), u, 'same-model increment');
  const compacted = { in: 10, out: 500, cr: 0, cw: 30000 };
  assert.strictEqual(baselineUsage(compacted, { ts: 0, ctx: 100000 }, 60e3), compacted, 'context shrank');
  const late = { in: 10, out: 500, cr: 0, cw: 102000 };
  assert.strictEqual(baselineUsage(late, { ts: 0, ctx: 100000 }, 2 * H), late, 'cache expired anyway');
  assert.strictEqual(baselineUsage(late, null, 60e3), late, 'first request');
});

test('fillBaselines walks a session in order', () => {
  const recs = fillBaselines([
    { ts: 0, in: 5, out: 1, cr: 0, cw: 50000 },          // first: real write
    { ts: 1e3, in: 5, out: 1, cr: 50000, cw: 1000 },     // same model, increment
    { ts: 2e3, in: 5, out: 1, cr: 0, cw: 51500 },        // switched: full rewrite
  ]);
  assert.strictEqual(recs[0].base.cw, 50000);
  assert.strictEqual(recs[1].base, recs[1]);
  assert.deepStrictEqual([recs[2].base.cr, recs[2].base.cw], [51000, 500]);
});

test('report: switching sessions no longer inflate the all-Opus baseline', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-switch-'));
  try {
    const S = '55555555-eeee-4eee-8eee-000000000005';
    const now = Date.now();
    const line = (id, model, ts, i, o, cr, cw) => JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), sessionId: S, cwd: '/x/app',
      uuid: 'u-' + id, isSidechain: false, message: { id, model, role: 'assistant', usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw } } });
    const dir = path.join(home, '.claude', 'projects', '-x-app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, S + '.jsonl'), [
      line('m1', 'claude-opus-5-5', now - 3 * 60e3, 10, 1000, 0, 200000),
      line('m2', 'claude-haiku-5-5', now - 2 * 60e3, 10, 300, 0, 201010),   // switch: rewrite
      line('m3', 'claude-opus-5-5', now - 1 * 60e3, 10, 1000, 200000, 1500), // back on Opus, its cache still warm
    ].join('\n') + '\n');
    const rep = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'report.js'), '--home', home, '--json', '--days', '1'], { encoding: 'utf8' }));
    // all-Opus: each request only writes what was added since the previous one, the rest is read from cache
    const opus = (i, o, cr, cw) => (i * 4 + o * 20 + cr * 0.2 + cw * 5) / 1e6;
    const base = opus(10, 1000, 0, 200000) + opus(10, 300, 200000, 1010) + opus(10, 1000, 201010, 490);
    assert.ok(Math.abs(rep.totals.baseline - base) < 1e-9, `${rep.totals.baseline} != ${base}`);
    assert.strictEqual(rep.totals.switchCacheWrites, 200000 + 1010);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

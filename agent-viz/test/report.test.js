'use strict';
// Run: node --test agent-viz/test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildHome, S1, S2, S3 } = require('./fixtures/build-home');

const REPORT = path.join(__dirname, '..', 'report.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-report-'));
buildHome(home);
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const run = (...args) => execFileSync(process.execPath, [REPORT, '--home', home, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const rep = JSON.parse(run('--json', '--days', '7'));

// Independent cost math (per million tokens)
const P = { haiku: [0.1, 0.5, 0.01, 0.125], sonnet: [2, 10, 0.2, 2.5], opus: [4, 20, 0.4, 5] };
const cost = (fam, i, o, cr, cw) => (i * P[fam][0] + o * P[fam][1] + cr * P[fam][2] + cw * P[fam][3]) / 1e6;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

const T = {
  haiku: [100000 + 50000 + 40000, 50000 + 20000 + 10000, 1000000 + 500000, 200000], // a1(last) + a3 + c2
  sonnet: [200000, 100000, 2000000, 0],                                            // a2
  opus: [300000 + 100000, 150000 + 80000, 3000000, 400000],                        // b1 + c1 (b0 too old)
};
const famCost = f => cost(f, ...T[f]);
const famBase = f => cost('opus', ...T[f]);
const totalCost = famCost('haiku') + famCost('sonnet') + famCost('opus');
const totalBase = famBase('haiku') + famBase('sonnet') + famBase('opus');

test('token totals, dedupe and window', () => {
  const by = Object.fromEntries(rep.models.map(m => [m.family, m]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['haiku', 'opus', 'sonnet', 'unpriced']);
  for (const f of ['haiku', 'sonnet', 'opus']) {
    assert.deepStrictEqual([by[f].input, by[f].output, by[f].cacheRead, by[f].cacheWrite], T[f], f);
  }
  assert.strictEqual(by.haiku.messages, 3, 'msg_a1 counted once despite two chunks');
  assert.strictEqual(by.opus.messages, 2, 'msg_b0 (10 days old) excluded');
  assert.strictEqual(by.unpriced.messages, 1);
  assert.strictEqual(by.unpriced.cost, null);
  assert.strictEqual(rep.totals.messages, 7);
  assert.strictEqual(rep.totals.input, T.haiku[0] + T.sonnet[0] + T.opus[0] + 5000);
  assert.strictEqual(rep.totals.unpricedMessages, 1);
  assert.strictEqual(rep.totals.sessions, 3);
  assert.strictEqual(rep.rawModels['<synthetic>'], undefined, 'synthetic model skipped');
  assert.strictEqual(rep.scan.filesSkippedOld, 1, 'old transcript skipped by mtime');
  assert.ok(rep.scan.badLines >= 1, 'malformed line tolerated');
});

test('cost math, baseline and savings', () => {
  const by = Object.fromEntries(rep.models.map(m => [m.family, m]));
  for (const f of ['haiku', 'sonnet', 'opus']) { close(by[f].cost, famCost(f), f + ' cost'); close(by[f].baseline, famBase(f), f + ' baseline'); }
  close(rep.totals.cost, totalCost, 'total cost');
  close(rep.totals.baseline, totalBase, 'baseline');
  close(rep.totals.saved, 1 - totalCost / totalBase, 'saved %');
  close(rep.totals.savedAmount, totalBase - totalCost, 'saved $');
  assert.strictEqual(rep.totals.verdict, 'saved');
  close(by.opus.share + by.sonnet.share + by.haiku.share, 1, 'shares sum to 1');
  assert.strictEqual(rep.baselineModel, 'opus');
});

test('routed vs other split', () => {
  const r = rep.routed;
  assert.ok(r, 'router folder present -> split reported');
  const routedCost = cost('haiku', 100000, 50000, 1000000, 200000) + cost('haiku', 50000, 20000, 500000, 0) + famCost('sonnet');
  const routedBase = cost('opus', 100000, 50000, 1000000, 200000) + cost('opus', 50000, 20000, 500000, 0) + famBase('sonnet');
  assert.strictEqual(r.routed.sessions, 1);
  assert.strictEqual(r.routed.messages, 3, 'sub-agent message counted with its parent session');
  close(r.routed.cost, routedCost, 'routed cost');
  close(r.routed.baseline, routedBase, 'routed baseline');
  close(r.routed.saved, 1 - routedCost / routedBase, 'routed saved');
  assert.strictEqual(r.other.sessions, 2);
  close(r.other.cost + r.routed.cost, totalCost, 'split adds up');
});

test('top sessions use project names from cwd, never full paths', () => {
  const ids = rep.topSessions.map(s => s.sessionId);
  assert.deepStrictEqual(new Set(ids), new Set([S1, S2, S3]));
  const s2 = rep.topSessions.find(s => s.sessionId === S2);
  assert.strictEqual(s2.project, 'shop-api', 'session id from file name when line has none');
  assert.strictEqual(rep.topSessions.find(s => s.sessionId === S3).project, 'blog-site');
  for (let i = 1; i < rep.topSessions.length; i++) assert.ok(rep.topSessions[i - 1].cost >= rep.topSessions[i].cost);
});

test('markdown: no personal paths, --no-projects hides names, footer present', () => {
  for (const lang of ['en', 'zh']) {
    const md = run('--md', '-', '--lang', lang);
    assert.ok(!md.includes('/Users/alice') && !md.includes('/home/bob') && !md.includes(home), 'no paths');
    assert.ok(md.includes('shop-api'));
    assert.ok(md.includes('https://github.com/paxon-yang/claude-agent-tools'));
    assert.ok(md.includes(lang === 'zh' ? '少花' : 'Saved'));
    const hidden = run('--md', '-', '--lang', lang, '--no-projects');
    assert.ok(!hidden.includes('shop-api') && !hidden.includes('blog-site'));
  }
  const file = path.join(home, 'out.md');
  run('--md', file, '--lang', 'en');
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('# '));
});

test('terminal output in both languages, and honest empty state', () => {
  const en = run('--lang', 'en');
  assert.match(en, /All on Opus/);
  assert.ok(!en.includes('\x1b['), 'no colors when not a TTY');
  const zh = run('--lang', 'zh');
  assert.match(zh, /近 7 天/);
  assert.match(zh, /全用 Opus 约/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-empty-'));
  try {
    const out = execFileSync(process.execPath, [REPORT, '--home', empty, '--lang', 'en'], { encoding: 'utf8' });
    assert.match(out, /No Claude Code usage found/);
    assert.ok(!/0%/.test(out));
    const j = JSON.parse(execFileSync(process.execPath, [REPORT, '--home', empty, '--json'], { encoding: 'utf8' }));
    assert.strictEqual(j.totals.verdict, 'nodata');
    assert.strictEqual(j.totals.saved, null);
    assert.strictEqual(j.routed, null, 'no router folder -> no split');
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('--since and --days 1 narrow the window', () => {
  const one = JSON.parse(run('--json', '--days', '1'));
  assert.strictEqual(one.totals.messages, 3, 'only S1 (5h ago) within 1 day');
  const far = JSON.parse(run('--json', '--since', '2000-01-01'));
  assert.strictEqual(far.totals.messages, 9, 'msg_b0 and the 30-day-old file included');
});

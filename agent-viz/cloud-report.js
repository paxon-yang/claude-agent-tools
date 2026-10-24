#!/usr/bin/env node
// Claude Code 看板 · 云端会话上报
// 在 Claude Code 云端会话（网页 / App / Projects）里，把 hook 事件发到你电脑上看板的卡片网址，
// 这样手机卡片和看板也能看到云端会话：用的哪个模型、在跑 / 等你 / 结束。
// 只在云端会话里、而且设置了 AGENT_CARD_URL 和 AGENT_CARD_KEY 两个环境变量时才工作；否则立刻退出。
// 发不出去也绝不影响 Claude Code。
//
// Cloud session reporter: in a Claude Code cloud session (web / app / Projects), send hook events to the
// card address of the board on your computer, so the phone card and the board show cloud sessions too.
// Runs only in a cloud session with AGENT_CARD_URL and AGENT_CARD_KEY set; otherwise exits at once.
// A failed send never affects Claude Code.
'use strict';
const fs = require('fs');

const URL_ = String(process.env.AGENT_CARD_URL || '').trim().replace(/\/+$/, '');
const KEY = String(process.env.AGENT_CARD_KEY || '').trim();
// 自查：在云端会话里运行  NODE_USE_ENV_PROXY=1 node agent-viz/cloud-report.js --check ，看哪一步没通
// self-check: run  NODE_USE_ENV_PROXY=1 node agent-viz/cloud-report.js --check  in a cloud session to see which step fails
if (process.argv.includes('--check')) {
  const say = (ok, msg) => console.log((ok ? '✓ ' : '✗ ') + msg);
  say(process.env.CLAUDE_CODE_REMOTE === 'true', 'cloud session (CLAUDE_CODE_REMOTE=true)');
  say(/^https:\/\//.test(URL_), 'AGENT_CARD_URL = ' + (URL_ || '(not set)'));
  say(KEY.length >= 16, 'AGENT_CARD_KEY ' + (KEY ? `set (${KEY.length} chars)` : '(not set)'));
  say(process.env.NODE_USE_ENV_PROXY === '1' || !process.env.HTTPS_PROXY, 'NODE_USE_ENV_PROXY=1 (Node fetch ignores HTTPS_PROXY without it)');
  if (!/^https:\/\//.test(URL_) || !KEY) process.exit(1);
  fetch(URL_ + '/api/widget', { headers: { 'X-Card-Key': KEY }, signal: AbortSignal.timeout(8000) })
    .then(r => { say(r.ok, `board answered HTTP ${r.status}` + (r.status === 401 ? ' (pairing key rejected)' : '')); process.exit(r.ok ? 0 : 1); })
    .catch(e => { say(false, 'cannot reach the board: ' + ((e.cause && (e.cause.code || e.cause.message)) || e.message) + ' (host not in Allowed domains, or the computer/tunnel is off)'); process.exit(1); });
  return;   // 下面是 hook 用的，自查时不走 / the rest is for the hook, not the check
} else if (process.env.CLAUDE_CODE_REMOTE !== 'true' || !/^https:\/\//.test(URL_) || KEY.length < 16) process.exit(0);

// 超长文字只保留开头和结尾（和 capture.js 一样）/ keep only the head and tail of long text (as capture.js does)
function trim(v, depth) {
  if (typeof v === 'string') return v.length > 2400 ? v.slice(0, 800) + ' …[truncated]… ' + v.slice(-1400) : v;
  if (depth > 6) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => trim(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = trim(v[k], depth + 1);
    return out;
  }
  return v;
}

// 看板读不到云端的会话记录，所以在这里读记录末尾，找出最近一条回复实际用的模型
// the board can't read a cloud transcript, so read its tail here for the model the latest reply actually used
function lastModel(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"assistant"')) continue;
        let o; try { o = JSON.parse(lines[i]); } catch { continue; }
        const m = o && o.type === 'assistant' && !o.isSidechain && o.message && o.message.model;
        if (m && !String(m).startsWith('<')) return m;
      }
    } finally { fs.closeSync(fd); }
  } catch { }
  return null;
}

let raw = '';
const timer = setTimeout(() => process.exit(0), 4000); // 保险：最多 4 秒 / at most 4 seconds
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(raw);
    const cloud = { model: data.transcript_path ? lastModel(data.transcript_path) : null };
    // claude.ai 上这个会话的网址，卡片的 ↗ 直接打开它 / the session's claude.ai address, opened by the card's ↗
    const rid = String(process.env.CLAUDE_CODE_REMOTE_SESSION_ID || '');
    if (/^cse_\w+$/.test(rid)) cloud.link = 'https://claude.ai/code/session_' + rid.slice(4);
    if (process.env.CLAUDE_CODE_PROJECTS_SESSION) cloud.project = true;
    if (process.env.CLAUDE_EFFORT) cloud.effort = String(process.env.CLAUDE_EFFORT);
    await fetch(URL_ + '/api/cloud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Card-Key': KEY, 'User-Agent': 'AgentCardCloud/1' },
      body: JSON.stringify({ ts: Date.now() / 1000, data: trim(data, 0), cloud }),
      signal: AbortSignal.timeout(3500),
    });
  } catch { /* 上报失败也绝不影响 Claude Code / never affects Claude Code */ }
  clearTimeout(timer);
  process.exit(0);
});

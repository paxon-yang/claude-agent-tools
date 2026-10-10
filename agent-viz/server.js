#!/usr/bin/env node
// Claude Code 看板 · 服务端
// 读取 ~/.claude/viz/events.jsonl（采集脚本写的）+ 会话记录 + ~/.claude/agents，
// 拼成"项目 → 任务 → 主会话 → 子代理"的树，推送给浏览器。全程只读，不改 Claude Code 的任何文件。
// 启动：node server.js            正式模式，打开 http://localhost:4321
//       node server.js --demo     演示模式（模拟数据），可配合 --port 4322
//       --lang en|zh              指定语言（控制台提示、演示数据、网页默认语言）；默认跟随 config.json 的 lang / 系统语言
// Usage: node server.js [--demo] [--port 4322] [--lang en|zh] [--log events.jsonl]
// The server keeps language-neutral data (log entries are key tuples); the browser translates.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 配置 ----------
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const VIZ = path.join(CLAUDE_DIR, 'viz');
const APP = __dirname;
const CONFIG = readJSON(path.join(APP, 'config.json')) || {};
const DEMO = flag('--demo');
const PORT = Number(opt('--port', CONFIG.port || 4321));
// ---------- 语言 / language ----------
// --lang > CAT_LANG > config.json "lang" > LC_ALL / LC_MESSAGES / LANG > macOS AppleLanguages > en
const LANG_FLAG = ['en', 'zh'].includes(opt('--lang', '')) ? opt('--lang', '') : null;
function detectLang() {
  if (LANG_FLAG) return LANG_FLAG;
  const env = String(process.env.CAT_LANG || '').toLowerCase();
  if (env === 'en' || env === 'zh') return env;
  if (CONFIG.lang === 'en' || CONFIG.lang === 'zh') return CONFIG.lang;
  const loc = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  if (/^zh/i.test(loc)) return 'zh';
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (/^zh/i.test(out.replace(/[\s"(]/g, ''))) return 'zh';
    } catch { }
  }
  return 'en';
}
const LANG = detectLang();
const L = (zh, en) => LANG === 'zh' ? zh : en;
const LOG = DEMO ? path.join(APP, LANG === 'zh' ? 'demo-events.jsonl' : 'demo-events.en.jsonl') : opt('--log', path.join(VIZ, 'events.jsonl'));
const CONTEXT_LIMIT = Number(CONFIG.contextLimit || 1000000);
const IDLE_MIN = Number(CONFIG.collapseAfterMinutes || 30);
const KEEP_HOURS = Number(CONFIG.keepHours || 24);
const ROTATE_MB = Number(CONFIG.rotateAtMB || 50);
const KEEP_ARCHIVES = Number(CONFIG.keepArchives || 7);
const REMOTE = CONFIG.remote || 'tailscale';           // 'tailscale'：同时在 Tailscale 地址上开放；'off'：只在本机
// 每百万 token 的美元价格（估算用）。cacheRead/cacheWrite 不填时按输入价的 0.1 倍 / 1.25 倍算
const PRICES = Object.assign({
  haiku: { in: 0.10, out: 0.50 },
  sonnet: { in: 2, out: 10 },
  opus: { in: 4, out: 20 },
  fable: { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 },
}, CONFIG.prices || {});
const BASELINE = CONFIG.baselineModel || 'opus';      // "全用这个模型要花多少"的对照

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const now = () => Date.now() / 1000;
const short = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- 模型名称 ----------
const FAMILIES = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'];
function family(m) { if (!m) return null; const s = String(m).toLowerCase(); return FAMILIES.find(f => s.includes(f)) || null; }
function prettyModel(m) {
  if (!m) return null;
  const s = String(m).toLowerCase().replace(/\[[^\]]*\]/g, '');
  const fam = family(s);
  if (!fam) return String(m);
  const name = fam[0].toUpperCase() + fam.slice(1);
  const rest = s.split(fam)[1] || '';
  const mm = rest.match(/^[-\s]?(\d+)(?:[-.](\d{1,2}))?(?!\d)/);
  if (!mm) return name;
  return name + ' ' + mm[1] + (mm[2] ? '.' + mm[2] : '');
}

// ---------- 读取用户配置：settings.json 与 agents/*.md ----------
let settings = {}, agentDefs = {};
function loadSettings() {
  const s = readJSON(path.join(CLAUDE_DIR, 'settings.json')) || {};
  settings = { model: s.model || null, advisorModel: s.advisorModel || null, effortLevel: s.effortLevel || null };
}
function loadAgentDefs() {
  const defs = {};
  const dir = path.join(CLAUDE_DIR, 'agents');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { }
  for (const f of files) {
    try {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fm) continue;
      const get = k => { const m = fm[1].match(new RegExp('^' + k + ':\\s*(.+)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
      const name = get('name') || f.replace(/\.md$/, '');
      defs[name] = { model: get('model'), effort: get('effort') };
    } catch { }
  }
  agentDefs = defs;
}
if (DEMO) {
  settings = { model: 'opus', advisorModel: 'fable', effortLevel: 'high' };
  agentDefs = { explorer: { model: 'sonnet', effort: 'medium' }, researcher: { model: 'sonnet', effort: 'medium' },
    'quick-worker': { model: 'sonnet', effort: 'medium' }, worker: { model: 'opus', effort: 'medium' } };
} else {
  loadSettings(); loadAgentDefs();
  setInterval(() => { loadSettings(); loadAgentDefs(); changed(); }, 15000);
}

// ---------- 状态 ----------
let sessions = new Map();
let stats = { events: 0, badLines: 0, startedAt: now() };

function getSession(d, ts) {
  const id = d.session_id || 'unknown';
  let s = sessions.get(id);
  if (!s) {
    s = { id, cwd: d.cwd || '', startedAt: ts, lastTs: ts, status: 'idle', ended: false,
      model: null, actualModel: null, effort: null, transcript: null,
      task: null, tasksDone: 0, toolCount: 0, currentTool: null, test: null,
      context: 0, outTokens: 0, seenMsg: new Set(),
      advisor: { calls: 0, last: null, lastAt: null },
      agents: new Map(), pendingSpawns: [], tools: new Map(), timeline: [],
      usage: new Map(), turns: [], decisions: [], msgModels: [], needMsg: null };
    sessions.set(id, s);
  }
  if (d.cwd && !s.cwd) s.cwd = d.cwd;
  if (d.transcript_path) s.transcript = d.transcript_path;
  s.lastTs = Math.max(s.lastTs, ts);
  return s;
}

function getAgent(s, id, type, ts) {
  let a = s.agents.get(id);
  if (!a) {
    a = { id, type: type || SUB, status: 'running', startedAt: ts, endedAt: null, description: null,
      spawnModel: null, actualModel: null, effort: null, currentTool: null, lastTool: null, toolCount: 0,
      lastMessage: null, test: null, transcript: null, taskId: s.task ? s.task.id : null };
    s.agents.set(id, a);
  }
  if (type && a.type === SUB) a.type = type;
  return a;
}

// 事件明细里的一条：text 是 [键, ...参数]，由网页按当前语言翻译（旧的纯文字也照常显示）
// A log entry's text is a key tuple like ['spawned', type, desc]; the browser renders it in the viewer's language.
function log(s, ts, who, text, kind) {
  s.timeline.push({ ts, who, text, kind: kind || 'info' });
  if (s.timeline.length > 120) s.timeline.splice(0, s.timeline.length - 120);
}

const SUB = 'subagent';   // 没有类型的子代理（网页上显示为"子代理"/"Subagent"）
function toolLabel(name, input) {
  input = input || {};
  const base = p => p ? path.basename(String(p)) : '';
  switch (name) {
    case 'Bash': return 'Bash · ' + short(input.description || input.command, 44);
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return name + ' · ' + base(input.file_path || input.notebook_path);
    case 'Grep': return 'Grep · ' + short(input.pattern, 32);
    case 'Glob': return 'Glob · ' + short(input.pattern, 32);
    case 'WebFetch': try { return 'WebFetch · ' + new URL(input.url).host; } catch { return 'WebFetch'; }
    case 'WebSearch': return 'WebSearch · ' + short(input.query, 32);
    case 'Agent': case 'Task': return 'Agent → ' + (input.subagent_type || SUB);
    default:
      if (String(name).startsWith('mcp__')) return 'MCP · ' + String(name).split('__').slice(1).join(' · ');
      return String(name || 'tool');
  }
}

function detectTest(input, response) {
  const cmd = String((input && input.command) || '');
  if (!/test|jest|vitest|pytest|mocha|spec|cargo t|go t|phpunit|rspec/i.test(cmd)) return null;
  let text = '';
  if (typeof response === 'string') text = response;
  else if (response) text = [response.stdout, response.stderr, response.output, response.content].filter(Boolean).map(String).join('\n');
  const pick = re => { let m, best = null; const r = new RegExp(re, 'gi'); while ((m = r.exec(text))) best = Number(m[1]); return best; };
  const passed = pick('(\\d+)\\s+(?:passed|passing)');
  const failed = pick('(\\d+)\\s+(?:failed|failing)');
  if (passed == null && failed == null) return null;
  return { passed: passed || 0, failed: failed || 0, total: (passed || 0) + (failed || 0) };
}

// Claude Code 把后台子代理的结果当成一条"消息"送回主会话，不是你发的新任务
function isHandback(p) {
  const t = String(p || '').trimStart();
  return t.startsWith('<agent-message') || t.startsWith('<task-notification') || t.includes('[Subagent hand-back]');
}
// Claude Code 内部的小助手（比如给后台子代理写进度摘要），不是派出去干活的子代理
function isHelper(a) { return a.type === SUB && !a.description && a.toolCount === 0; }

function isSpawn(name) { return name === 'Agent' || name === 'Task'; }

// ---------- 处理一条事件 ----------
function handle(line) {
  const d = line && line.data;
  if (!d || !d.hook_event_name) return;
  const ts = Number(line.ts) || now();
  if (!DEMO && now() - ts > KEEP_HOURS * 3600) return;
  stats.events++;
  const e = d.hook_event_name;
  const s = getSession(d, ts);
  const inAgent = !!d.agent_id;
  const agent = inAgent ? getAgent(s, d.agent_id, d.agent_type, ts) : null;
  const level = d.effort && d.effort.level;
  if (level) { if (agent) agent.effort = level; else s.effort = level; }
  if (s.ended && e !== 'SessionEnd') s.ended = false;

  switch (e) {
    case 'SessionStart':
      if (d.model) s.model = d.model;
      log(s, ts, 'main', [d.source === 'resume' ? 'sessionResumed' : 'sessionStart'], 'session');
      break;
    case 'SessionEnd':
      s.ended = true; s.status = 'ended'; s.currentTool = null; s.needMsg = null;
      closeTurn(s, ts);
      if (s.task && !s.task.endedAt) { s.task.endedAt = ts; s.tasksDone++; }
      log(s, ts, 'main', ['sessionEnd'], 'session');
      break;
    case 'UserPromptSubmit': {
      if (isHandback(d.prompt)) {
        s.status = 'running';
        const last = s.turns[s.turns.length - 1];
        if (!last || last.end) pushTurn(s, { start: ts, end: null, prompt: '', handback: true });
        log(s, ts, 'main', ['handback'], 'info');
        break;
      }
      closeTurn(s, ts);
      pushTurn(s, { start: ts, end: null, prompt: short(d.prompt, 240), handback: false });
      if (s.task && !s.task.endedAt) s.task.endedAt = ts;
      s.task = { id: d.prompt_id || String(ts), prompt: short(d.prompt, 300), startedAt: ts, endedAt: null };
      s.status = 'running'; s.test = null;
      log(s, ts, 'you', ['newTask', short(d.prompt, 60)], 'task');
      break;
    }
    case 'PreToolUse': {
      const label = toolLabel(d.tool_name, d.tool_input);
      const step = { ts, label, end: null, ok: null };
      const owner = agent || s;
      owner.steps = owner.steps || [];
      owner.steps.push(step);
      if (owner.steps.length > 40) owner.steps.splice(0, owner.steps.length - 40);
      const rec = { label, agentId: d.agent_id || null, startedAt: ts, step };
      if (d.tool_use_id) s.tools.set(d.tool_use_id, rec);
      if (agent) { agent.currentTool = label; agent.lastTool = label; agent.toolCount++; agent.status = 'running'; }
      else { s.currentTool = label; s.lastTool = label; s.toolCount++; if (s.status !== 'running') s.status = 'running'; s.needMsg = null; }
      if (isSpawn(d.tool_name)) {
        const ti = d.tool_input || {};
        s.pendingSpawns.push({ toolUseId: d.tool_use_id, type: ti.subagent_type || null,
          description: ti.description || short(ti.prompt, 60), model: ti.model || null, ts, used: false });
        log(s, ts, agent ? agent.type : 'main', ['spawned', ti.subagent_type || SUB, short(ti.description || ti.prompt, 50)], 'spawn');
      }
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const failed = e === 'PostToolUseFailure';
      const rec0 = d.tool_use_id && s.tools.get(d.tool_use_id);
      if (rec0 && rec0.step) { rec0.step.end = ts; rec0.step.ok = !failed; }
      if (d.tool_use_id) s.tools.delete(d.tool_use_id);
      if (agent) agent.currentTool = null; else s.currentTool = null;
      if (d.tool_name === 'Bash') {
        const t = detectTest(d.tool_input, d.tool_response);
        if (t) {
          if (agent) agent.test = t; else s.test = t;
          log(s, ts, agent ? agent.type : 'main', ['tests', t.passed, t.total], t.failed ? 'warn' : 'good');
        }
      }
      if (isSpawn(d.tool_name)) {
        // 派出的子代理整体结束（SubagentStop 没到时的兜底）
        for (const a of s.agents.values()) {
          if (a.toolUseId === d.tool_use_id && a.status === 'running') { a.status = failed ? 'failed' : 'done'; a.endedAt = ts; }
        }
      }
      if (failed && !isSpawn(d.tool_name)) log(s, ts, agent ? agent.type : 'main', ['toolFailed', toolLabel(d.tool_name, d.tool_input)], 'bad');
      break;
    }
    case 'SubagentStart': {
      const a = agent || getAgent(s, d.agent_id || ('a' + ts), d.agent_type, ts);
      a.status = 'running'; a.startedAt = Math.min(a.startedAt, ts); a.taskId = s.task ? s.task.id : null;
      const typed = a.type !== SUB;
      const p = typed
        ? (s.pendingSpawns.find(x => !x.used && (!x.type || x.type === a.type)) || s.pendingSpawns.find(x => !x.used))
        : s.pendingSpawns.find(x => !x.used && !x.type);
      if (p) { p.used = true; a.description = p.description; a.spawnModel = p.model; a.toolUseId = p.toolUseId; }
      if (d._demo_model) a.actualModel = d._demo_model;
      break;
    }
    case 'SubagentStop': {
      const a = agent || getAgent(s, d.agent_id || ('a' + ts), d.agent_type, ts);
      a.status = d.exit_reason === 'error' ? 'failed' : d.exit_reason === 'interrupted' ? 'stopped' : 'done';
      a.endedAt = ts; a.currentTool = null;
      if (d.last_assistant_message) a.lastMessage = short(d.last_assistant_message, 1500);
      if (d.agent_transcript_path) a.transcript = d.agent_transcript_path;
      const dur = Math.max(0, Math.round(ts - a.startedAt));
      if (!isHelper(a)) log(s, ts, a.type, ['agentEnded', a.status, dur], a.status === 'done' ? 'good' : 'bad');
      break;
    }
    case 'Stop':
      s.status = 'idle'; s.currentTool = null; s.needMsg = null;
      closeTurn(s, ts);
      if (s.task && !s.task.endedAt) { s.task.endedAt = ts; s.tasksDone++; }
      log(s, ts, 'main', ['turnDone'], 'session');
      break;
    case 'Notification':
      if (/permission|needs_input/.test(d.notification_type || d.message || '')) {
        s.status = 'needs-you'; s.needMsg = short(d.message, 120); s.needAt = ts;
        log(s, ts, 'main', ['needsYou', short(d.message, 50)], 'warn');
      }
      break;
    case 'PostModelSwitch':
      if (d.to_model) { s.model = d.to_model; s.actualModel = null; }
      log(s, ts, 'main', ['modelSwitch', prettyModel(d.to_model)], 'info');
      break;
    case 'PostCompact':
      log(s, ts, 'main', ['compacted'], 'warn');
      break;
    // 以下为演示模式专用的模拟事件
    case 'DemoHistory': {
      // 演示用：一次性补上一个会话过去几轮的记录和用量
      if (d.cwd) s.cwd = d.cwd;
      for (const tu of d.turns || []) {
        pushTurn(s, { start: ts - tu.ago, end: tu.dur == null ? null : ts - tu.ago + tu.dur, prompt: tu.prompt, handback: false });
        addDecision(s, { at: ts - tu.ago, model: 'claude-' + tu.fam + '-5-5', effort: tu.effort || 'medium', reason: tu.reason || '', by: tu.by || 'rule' });
        if (tu.dur != null) s.tasksDone++;
      }
      for (const [fam, u] of Object.entries(d.usage || {})) addUsage(s, 'demo-h-' + fam, 'claude-' + fam, { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] });
      if (d.model) s.actualModel = d.model;
      if (d.status) s.status = d.status;
      if (d.needMsg) { s.status = 'needs-you'; s.needMsg = d.needMsg; }
      if (d.context) s.context = d.context;
      s.startedAt = Math.min(s.startedAt, ts - Math.max(...(d.turns || [{ ago: 0 }]).map(x => x.ago)));
      break;
    }
    case 'DemoUsage': {
      const target = d.agent_id ? getAgent(s, d.agent_id, d.agent_type, ts) : null;
      addUsage(s, 'demo-' + stats.events, d.model, { input_tokens: d.in, output_tokens: d.out, cache_read_input_tokens: d.cr || 0, cache_creation_input_tokens: d.cw || 0 });
      if (!target) s.msgModels.push({ ts, fam: family(d.model) });
      break;
    }
    case 'DemoTranscript':
      if (d.model) s.actualModel = d.model;
      if (d.context) s.context = d.context;
      if (d.out) s.outTokens = d.out;
      break;
    case 'DemoRoute': {
      const by = d.by || 'haiku', model = d.model || 'claude-opus-5-5', effort = d.effort || 'high';
      addDecision(s, { at: ts, model, effort, reason: d.reason, by });
      s.route = { mode: 'auto', last: { reason: d.reason }, advisorCalls: s.advisor.calls };
      log(s, ts, 'router', ['route', prettyModel(model), effort, by, d.reason || ''], 'route');
      break;
    }
    case 'DemoAdvisor':
      s.advisor.calls++; s.advisor.last = d.text; s.advisor.lastAt = ts; s.advisor.moment = d.moment;
      log(s, ts, 'advisor', ['advisor', d.moment || '', short(d.text, 40)], 'advisor');
      break;
  }
  changed();
}

// ---------- 轮次、用量、模型选择 ----------
function pushTurn(s, t) {
  s.turns.push(t);
  if (s.turns.length > 60) s.turns.splice(0, s.turns.length - 60);
}
function closeTurn(s, ts) {
  const t = s.turns[s.turns.length - 1];
  if (t && !t.end) t.end = ts;
}
function addUsage(s, key, model, u) {
  const fam = family(model);
  if (!fam || !u) return;
  // 同一条消息在会话记录里可能分几行写入，用最后一次的数字
  s.usage.set(key, { fam, in: u.input_tokens || 0, out: u.output_tokens || 0,
    cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0 });
  if (s.usage.size > 20000) s.usage.delete(s.usage.keys().next().value);
}
function addDecision(s, d) {
  s.decisions.push({ at: d.at, fam: family(d.model), model: prettyModel(d.model), effort: d.effort, reason: d.reason, by: d.by });
  if (s.decisions.length > 300) s.decisions.splice(0, s.decisions.length - 300);
}
function price(fam) {
  const p = PRICES[fam];
  if (!p || p.in == null) return null;
  return { in: p.in, out: p.out, cr: p.cacheRead != null ? p.cacheRead : p.in * 0.1, cw: p.cacheWrite != null ? p.cacheWrite : p.in * 1.25 };
}
function costOf(u, fam) {
  const p = price(fam);
  if (!p) return null;
  return (u.in * p.in + u.out * p.out + u.cr * p.cr + u.cw * p.cw) / 1e6;
}
function usageSummary(maps) {
  const by = {};
  for (const m of maps) for (const u of m.values()) {
    const b = by[u.fam] || (by[u.fam] = { in: 0, out: 0, cr: 0, cw: 0 });
    b.in += u.in; b.out += u.out; b.cr += u.cr; b.cw += u.cw;
  }
  let cost = 0, baseline = 0, unpriced = false;
  for (const fam of Object.keys(by)) {
    const c = costOf(by[fam], fam);
    by[fam].cost = c;
    by[fam].tokens = by[fam].in + by[fam].out + by[fam].cr + by[fam].cw;
    if (c == null) unpriced = true; else cost += c;
    const b = costOf(by[fam], BASELINE);
    if (b != null) baseline += b;
  }
  return { byModel: by, cost, baseline, saved: baseline > 0 ? Math.max(0, 1 - cost / baseline) : null, unpriced };
}

// ---------- 按行读取不断增长的文件 ----------
const readers = new Map();
function readNew(p, onLine, firstTailBytes) {
  let r = readers.get(p);
  let st;
  try { st = fs.statSync(p); } catch { return false; }
  if (!r) {
    r = { offset: 0, ino: st.ino, rest: Buffer.alloc(0), skipFirst: false };
    if (firstTailBytes && st.size > firstTailBytes) { r.offset = st.size - firstTailBytes; r.skipFirst = true; }
    readers.set(p, r);
  }
  if (st.ino !== r.ino || st.size < r.offset) { r.offset = 0; r.ino = st.ino; r.rest = Buffer.alloc(0); r.skipFirst = false; }
  while (r.offset < st.size) {
    const len = Math.min(st.size - r.offset, 8 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(p, 'r');
    try { fs.readSync(fd, buf, 0, len, r.offset); } finally { fs.closeSync(fd); }
    r.offset += len;
    let data = Buffer.concat([r.rest, buf]);
    let start = 0, nl;
    while ((nl = data.indexOf(10, start)) !== -1) {
      const lineBuf = data.subarray(start, nl);
      start = nl + 1;
      if (r.skipFirst) { r.skipFirst = false; continue; }
      const text = lineBuf.toString('utf8').trim();
      if (!text) continue;
      let o; try { o = JSON.parse(text); } catch { stats.badLines++; continue; }
      try { onLine(o); } catch (err) { stats.badLines++; }
    }
    r.rest = Buffer.from(data.subarray(start));
  }
  return true;
}

// ---------- 会话记录：实际模型、上下文、顾问 ----------
function onTranscript(s, o) {
  if (o.isSidechain) return;
  const m = o.message;
  if (!m || typeof m !== 'object') return;
  const ts = o.timestamp ? Date.parse(o.timestamp) / 1000 : now();
  if (o.type === 'assistant') {
    if (m.model && !String(m.model).startsWith('<')) {
      s.actualModel = m.model;
      const key0 = m.id || o.uuid;
      if (key0 !== s.lastMsgKey) { s.lastMsgKey = key0; s.msgModels.push({ ts, fam: family(m.model) }); if (s.msgModels.length > 3000) s.msgModels.splice(0, 1000); }
      if (m.usage) addUsage(s, 'm:' + key0, m.model, m.usage);
    }
    const u = m.usage;
    if (u) {
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx) s.context = ctx;
      const key = m.id || o.uuid;
      if (key && !s.seenMsg.has(key)) {
        s.seenMsg.add(key); s.outTokens += u.output_tokens || 0;
        if (s.seenMsg.size > 5000) s.seenMsg = new Set([...s.seenMsg].slice(-2000));
      }
    }
  }
  const content = Array.isArray(m.content) ? m.content : [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'server_tool_use' && c.name === 'advisor') {
      if (!s.advisorSeen) s.advisorSeen = new Set();
      if (c.id && s.advisorSeen.has(c.id)) continue;
      if (c.id) s.advisorSeen.add(c.id);
      s.advisor.calls++; s.advisor.lastAt = ts;
      log(s, ts, 'advisor', ['advisor'], 'advisor');
    }
    if (c.type === 'advisor_tool_result') {
      let t = '';
      if (typeof c.content === 'string') t = c.content;
      else if (c.content && typeof c.content.text === 'string') t = c.content.text;
      else if (Array.isArray(c.content)) t = c.content.map(x => x && x.text).filter(Boolean).join('\n');
      if (t) s.advisor.last = short(t, 700);
    }
  }
}

function onAgentTranscript(s, a, o) {
  const m = o.message;
  if (o.type === 'assistant' && m && m.model && !String(m.model).startsWith('<')) {
    a.actualModel = m.model;
    if (m.usage) addUsage(s, 'a:' + a.id + ':' + (m.id || o.uuid), m.model, m.usage);
  }
}

function pollRouter(s) {
  const r = readJSON(path.join(VIZ, 'router', s.id + '.json'));
  if (!r || !Array.isArray(r.decisions)) return;
  const last = r.decisions[r.decisions.length - 1] || null;
  const key = JSON.stringify([r.mode, r.decisions.length, last && last.at]);
  if (key === s.routeKey) return;
  s.routeKey = key;
  const seen = s.routeSeen || 0;
  for (const d of r.decisions) {
    if (d.at / 1000 <= seen) continue;
    // by 存的是键（plan / midTurn / handback / manual / pin / continue / escalate / rule / haiku / fallback / guard / phase），网页负责翻译
    const pr = String(d.prompt || '');
    const by = d.phase === 'plan' ? 'plan'
      : d.midTurn || pr.includes('本轮中途升档') || pr.includes('(mid-turn escalation)') ? 'midTurn'
      : d.handback ? 'handback'
      : d.source || '';
    log(s, d.at / 1000, 'router', ['route', prettyModel(d.model), d.effort, by, d.reason || ''], 'route');
    addDecision(s, { at: d.at / 1000, model: d.model, effort: d.effort, reason: d.reason, by });
  }
  if (last) s.routeSeen = last.at / 1000;
  s.route = { mode: r.mode, last, advisorCalls: r.advisorCalls || 0, pendingDown: r.pendingDown || null };
  s.timeline.sort((a, b) => a.ts - b.ts);
  changed();
}

function pollTranscripts() {
  const t = now();
  for (const s of sessions.values()) {
    // 不活跃的会话不再盯着读，但至少读一次（看板重启后也能显示它用过的模型和花费）
    if (t - s.lastTs > IDLE_MIN * 60 && s.readOnce) continue;
    s.readOnce = true;
    pollRouter(s);
    if (s.transcript) {
      const before = s.context + '|' + s.actualModel + '|' + s.advisor.calls + '|' + s.advisor.last;
      readNew(s.transcript, o => onTranscript(s, o), 6 * 1024 * 1024);
      if (before !== s.context + '|' + s.actualModel + '|' + s.advisor.calls + '|' + s.advisor.last) changed();
    }
    for (const a of s.agents.values()) {
      if (a.finalRead) continue;
      if (a.endedAt) a.finalRead = true;   // 结束后再读最后一次，把用量读全
      const guesses = [];
      if (a.transcript) guesses.push(a.transcript);
      if (s.transcript) {
        const dir = path.dirname(s.transcript);
        guesses.push(path.join(dir, s.id, 'subagents', `agent-${a.id}.jsonl`));
        guesses.push(path.join(dir, `agent-${a.id}.jsonl`));
      }
      for (const g of guesses) {
        if (readNew(g, o => onAgentTranscript(s, a, o), 4 * 1024 * 1024)) { changed(); break; }
      }
    }
  }
}

// ---------- 对外输出的快照 ----------
function resolveAgentModel(s, a) {
  const def = agentDefs[a.type] || {};
  const m = a.actualModel || a.spawnModel || (def.model && def.model !== 'inherit' ? def.model : null);
  return m || sessionModel(s);
}
function sessionModel(s) { return s.actualModel || s.model || settings.model || null; }

function view(s) {
  const t = now();
  const active = !s.ended && t - s.lastTs < IDLE_MIN * 60;
  const all = [...s.agents.values()].filter(a => !isHelper(a)).sort((x, y) => x.startedAt - y.startedAt);
  const cur = s.task ? all.filter(a => a.taskId === s.task.id) : all;
  const shown = (cur.length ? cur : all.slice(-6));
  const model = sessionModel(s);
  return {
    id: s.id, project: path.basename(s.cwd || ''), cwd: s.cwd,
    active, status: active ? s.status : 'ended',
    model: prettyModel(model), family: family(model),
    effort: (s.route && s.route.mode !== 'off' && s.route.last && s.route.last.effort) || s.effort || settings.effortLevel || null,
    startedAt: s.startedAt, lastTs: s.lastTs, task: s.task, tasksDone: s.tasksDone,
    toolCount: s.toolCount, currentTool: s.currentTool, lastTool: s.lastTool || null, test: s.test,
    context: s.context, contextLimit: CONTEXT_LIMIT, outTokens: s.outTokens,
    advisor: s.advisor, route: s.route || null,
    agents: shown.map(a => {
      const m = resolveAgentModel(s, a);
      const def = agentDefs[a.type] || {};
      return { id: a.id, type: a.type, model: prettyModel(m), family: family(m),
        modelSource: a.actualModel ? 'actual' : a.spawnModel ? 'spawn' : def.model ? 'agentDef' : 'inherit',
        effort: a.effort || def.effort || null, status: a.status, description: a.description,
        startedAt: a.startedAt, endedAt: a.endedAt, currentTool: a.currentTool, lastTool: a.lastTool, toolCount: a.toolCount,
        lastMessage: a.lastMessage, test: a.test, steps: (a.steps || []).slice(-30) };
    }),
    earlierAgents: all.length - shown.length, totalAgents: all.length,
    timeline: s.timeline.slice(-40),
    needMsg: s.needMsg || null,
    steps: (s.steps || []).slice(-30),
    decisions: s.decisions.slice(-12),
    turns: turnsView(s, t),
    lanes: all.slice(-24).map(a => {
      const m = resolveAgentModel(s, a);
      return { id: a.id, type: a.type, family: family(m), model: prettyModel(m), start: a.startedAt, end: a.endedAt, status: a.status, description: a.description };
    }),
    usage: usageSummary([s.usage]),
  };
}

// 每一轮：起止时间、你说了什么、用了哪些模型（模型中途换了就分成几段）
function turnsView(s, t) {
  const fallback = family(sessionModel(s));
  return s.turns.slice(-30).map(tu => {
    const end = tu.end || t;
    const ds = s.decisions.filter(d => d.at >= tu.start - 3 && d.at <= end);
    let segs;
    if (ds.length) {
      segs = ds.map((d, i) => ({ start: i ? d.at : tu.start, family: d.fam, model: d.model, effort: d.effort, reason: d.reason, by: d.by }));
    } else {
      const counts = {};
      for (const mm of s.msgModels) if (mm.ts >= tu.start && mm.ts <= end && mm.fam) counts[mm.fam] = (counts[mm.fam] || 0) + 1;
      const fam = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || fallback;
      segs = [{ start: tu.start, family: fam, model: fam ? fam[0].toUpperCase() + fam.slice(1) : null }];
    }
    return { start: tu.start, end: tu.end, prompt: tu.prompt, handback: tu.handback, segs };
  });
}

function snapshot() {
  const t = now();
  const list = [...sessions.values()]
    .filter(s => DEMO || t - s.lastTs < KEEP_HOURS * 3600)
    .sort((a, b) => b.lastTs - a.lastTs).slice(0, 20).map(view);
  const recent = [...sessions.values()].filter(s => DEMO || t - s.lastTs < KEEP_HOURS * 3600);
  const all = usageSummary(recent.map(s => s.usage));
  const tasks = recent.reduce((n, s) => n + s.turns.filter(x => !x.handback && x.end).length, 0);
  return { now: t, demo: DEMO, lang: LANG_FLAG || CONFIG.lang || 'auto', settings: { model: prettyModel(settings.model), advisorModel: prettyModel(settings.advisorModel),
    advisorFamily: family(settings.advisorModel), effortLevel: settings.effortLevel },
    sessions: list, stats: { events: stats.events, badLines: stats.badLines },
    totals: { ...all, tasks, sessions: recent.length, hours: KEEP_HOURS, baselineModel: BASELINE },
    needsYou: list.filter(x => x.active && x.status === 'needs-you').map(x => ({ id: x.id, project: x.project, msg: x.needMsg })),
    remote: remoteInfo() };
}

// ---------- 推送 ----------
const clients = new Set();
let dirty = true;
function changed() { dirty = true; }
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  const msg = 'data: ' + JSON.stringify(snapshot()) + '\n\n';
  for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
}, 250);
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 20000);

// ---------- 日志轮转（只处理看板自己的文件） ----------
function rotate() {
  if (DEMO) return;
  try {
    const st = fs.statSync(LOG);
    if (st.size < ROTATE_MB * 1024 * 1024) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    fs.renameSync(LOG, path.join(VIZ, `events-${stamp}.jsonl`));
    const archives = fs.readdirSync(VIZ).filter(f => /^events-\d+\.jsonl$/.test(f)).sort();
    for (const f of archives.slice(0, Math.max(0, archives.length - KEEP_ARCHIVES))) fs.unlinkSync(path.join(VIZ, f));
    console.log(L('日志已归档', 'Event log archived'));
  } catch { }
}

// ---------- 数据来源：正式模式 / 演示模式 ----------
if (DEMO) {
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const play = () => {
    sessions = new Map(); changed();
    let i = 0;
    const base = now();
    const t0 = lines[0].ts;
    let clock = base;
    const step = () => {
      if (i >= lines.length) { setTimeout(play, 8000); return; }
      const ln = lines[i];
      const gap = i ? Math.min(ln.ts - lines[i - 1].ts, 1.6) : 0;
      clock += gap;
      setTimeout(() => { handle({ ts: clock, data: ln.data }); i++; step(); }, gap * 1000);
    };
    void t0;
    step();
  };
  play();
} else {
  fs.mkdirSync(VIZ, { recursive: true });
  rotate();
  setInterval(rotate, 10 * 60 * 1000);
  readNew(LOG, handle);
  setInterval(() => readNew(LOG, handle), 400);
  setInterval(pollTranscripts, 2000);
  pollTranscripts();
}
setInterval(changed, 5000); // 让"已运行时长"和折叠状态定期刷新

// ---------- 网页服务（只监听本机） ----------
const INDEX = path.join(APP, 'public', 'index.html');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/stream') {
    // no-transform / X-Accel-Buffering：经过 Cloudflare 隧道时不要缓冲，事件要立刻送到浏览器
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(snapshot(), null, 2));
    return;
  }
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, demo: DEMO, events: stats.events, log: LOG }));
    return;
  }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); res.end(L('index.html 不见了', 'index.html is missing')); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(L(`✗ 端口 ${PORT} 已被占用。看板可能已经在运行了，直接打开 http://localhost:${PORT} 试试。`, `✗ Port ${PORT} is already in use. The board may already be running — try opening http://localhost:${PORT}.`));
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(L(`✓ Claude Code 看板已启动${DEMO ? '（演示模式）' : ''}：http://localhost:${PORT}`, `✓ Claude Code Agent Board is running${DEMO ? ' (demo mode)' : ''}: http://localhost:${PORT}`));
  if (!DEMO) {
    console.log(L('  数据来源：', '  Reading events from: ') + LOG);
    // 记下进程号，Windows 上安装/卸载脚本靠它停掉旧的看板
    try { fs.writeFileSync(path.join(VIZ, 'server.pid'), String(process.pid)); } catch { }
    const rm = () => { try { if (fs.readFileSync(path.join(VIZ, 'server.pid'), 'utf8') === String(process.pid)) fs.unlinkSync(path.join(VIZ, 'server.pid')); } catch { } process.exit(0); };
    process.on('SIGINT', rm); process.on('SIGTERM', rm);
  }
});

// ---------- 远程访问：只在 Tailscale 的私有地址上额外开放（100.64.0.0/10，只有你登录同一账号的设备能连） ----------
const remote = { ips: new Map(), dnsName: null, hostName: null, cli: null };
function tailscaleIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      const [x, y] = a.address.split('.').map(Number);
      if (x === 100 && y >= 64 && y <= 127) out.push(a.address);
    }
  }
  return out;
}
function findTailscaleCli() {
  const c = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')];
  return c.find(p => { try { fs.accessSync(p, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return true; } catch { return false; } }) || null;
}
function refreshTailscaleName() {
  if (!remote.cli) remote.cli = findTailscaleCli();
  if (!remote.cli) return;
  require('child_process').execFile(remote.cli, ['status', '--json'], { timeout: 4000 }, (err, stdout) => {
    if (err) return;
    try {
      const j = JSON.parse(stdout);
      remote.dnsName = j.Self && j.Self.DNSName ? j.Self.DNSName.replace(/\.$/, '') : null;
      remote.hostName = j.Self && j.Self.HostName ? j.Self.HostName : null;
      changed();
    } catch { }
  });
}
function syncRemote() {
  if (REMOTE === 'off' || DEMO) return;
  const want = new Set(tailscaleIPs());
  for (const [ip, srv] of remote.ips) if (!want.has(ip)) { try { srv.close(); } catch { } remote.ips.delete(ip); changed(); }
  for (const ip of want) {
    if (remote.ips.has(ip)) continue;
    const srv = http.createServer((req, res) => server.emit('request', req, res));
    srv.on('error', () => { remote.ips.delete(ip); });
    srv.listen(PORT, ip, () => { console.log(L('✓ Tailscale 远程地址：', '✓ Tailscale remote address: ') + `http://${ip}:${PORT}`); changed(); });
    remote.ips.set(ip, srv);
    refreshTailscaleName();
  }
}
function remoteInfo() {
  // cloudflare.sh 配好隧道后会写下公网地址
  const pub = readJSON(path.join(VIZ, 'remote.json'));
  if (pub && pub.url) return { mode: 'cloudflare', urls: [pub.url], public: true, tailscale: remote.ips.size > 0 };
  if (REMOTE === 'off') return { mode: 'off', urls: [] };
  const urls = [];
  if (remote.ips.size) {
    if (remote.dnsName) urls.push(`http://${remote.dnsName}:${PORT}`);
    for (const ip of remote.ips.keys()) urls.push(`http://${ip}:${PORT}`);
  }
  return { mode: REMOTE, urls, tailscale: remote.ips.size > 0, cli: !!remote.cli };
}
syncRemote();
setInterval(syncRemote, 30000);
setInterval(refreshTailscaleName, 10 * 60 * 1000);

#!/usr/bin/env node
// Claude Code 看板 · 服务端
// 读取 ~/.claude/viz/events.jsonl（采集脚本写的）+ 会话记录 + ~/.claude/agents，
// 拼成"项目 → 任务 → 主会话 → 子代理"的树，推送给浏览器。全程只读，不改 Claude Code 的任何文件。
// 启动：node server.js            正式模式，打开 http://localhost:4321
//       node server.js --demo     演示模式（模拟数据），可配合 --port 4322
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
const LOG = DEMO ? path.join(APP, 'demo-events.jsonl') : opt('--log', path.join(VIZ, 'events.jsonl'));
const CONTEXT_LIMIT = Number(CONFIG.contextLimit || 1000000);
const IDLE_MIN = Number(CONFIG.collapseAfterMinutes || 30);
const KEEP_HOURS = Number(CONFIG.keepHours || 24);
const ROTATE_MB = Number(CONFIG.rotateAtMB || 50);
const KEEP_ARCHIVES = Number(CONFIG.keepArchives || 7);

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
      agents: new Map(), pendingSpawns: [], tools: new Map(), timeline: [] };
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
    a = { id, type: type || '子代理', status: 'running', startedAt: ts, endedAt: null, description: null,
      spawnModel: null, actualModel: null, effort: null, currentTool: null, lastTool: null, toolCount: 0,
      lastMessage: null, test: null, transcript: null, taskId: s.task ? s.task.id : null };
    s.agents.set(id, a);
  }
  if (type && a.type === '子代理') a.type = type;
  return a;
}

function log(s, ts, who, text, kind) {
  s.timeline.push({ ts, who, text, kind: kind || 'info' });
  if (s.timeline.length > 120) s.timeline.splice(0, s.timeline.length - 120);
}

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
    case 'Agent': case 'Task': return '派出 ' + (input.subagent_type || '子代理');
    default:
      if (String(name).startsWith('mcp__')) return 'MCP · ' + String(name).split('__').slice(1).join(' · ');
      return String(name || '工具');
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
function isHelper(a) { return a.type === '子代理' && !a.description && a.toolCount === 0; }

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
      log(s, ts, 'main', d.source === 'resume' ? '恢复会话' : '会话开始', 'session');
      break;
    case 'SessionEnd':
      s.ended = true; s.status = 'ended'; s.currentTool = null;
      log(s, ts, 'main', '会话结束', 'session');
      break;
    case 'UserPromptSubmit': {
      if (isHandback(d.prompt)) {
        s.status = 'running';
        log(s, ts, 'main', '收到子代理交回的结果，整理中', 'info');
        break;
      }
      if (s.task && !s.task.endedAt) s.task.endedAt = ts;
      s.task = { id: d.prompt_id || String(ts), prompt: short(d.prompt, 300), startedAt: ts, endedAt: null };
      s.status = 'running'; s.test = null;
      log(s, ts, 'you', '新任务：' + short(d.prompt, 60), 'task');
      break;
    }
    case 'PreToolUse': {
      const label = toolLabel(d.tool_name, d.tool_input);
      const rec = { label, agentId: d.agent_id || null, startedAt: ts };
      if (d.tool_use_id) s.tools.set(d.tool_use_id, rec);
      if (agent) { agent.currentTool = label; agent.lastTool = label; agent.toolCount++; agent.status = 'running'; }
      else { s.currentTool = label; s.lastTool = label; s.toolCount++; if (s.status !== 'running') s.status = 'running'; }
      if (isSpawn(d.tool_name)) {
        const ti = d.tool_input || {};
        s.pendingSpawns.push({ toolUseId: d.tool_use_id, type: ti.subagent_type || null,
          description: ti.description || short(ti.prompt, 60), model: ti.model || null, ts, used: false });
        log(s, ts, agent ? agent.type : 'main', `派出 ${ti.subagent_type || '子代理'}：${short(ti.description || ti.prompt, 50)}`, 'spawn');
      }
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const failed = e === 'PostToolUseFailure';
      if (d.tool_use_id) s.tools.delete(d.tool_use_id);
      if (agent) agent.currentTool = null; else s.currentTool = null;
      if (d.tool_name === 'Bash') {
        const t = detectTest(d.tool_input, d.tool_response);
        if (t) {
          if (agent) agent.test = t; else s.test = t;
          log(s, ts, agent ? agent.type : 'main', `测试 ${t.passed}/${t.total} 通过`, t.failed ? 'warn' : 'good');
        }
      }
      if (isSpawn(d.tool_name)) {
        // 派出的子代理整体结束（SubagentStop 没到时的兜底）
        for (const a of s.agents.values()) {
          if (a.toolUseId === d.tool_use_id && a.status === 'running') { a.status = failed ? 'failed' : 'done'; a.endedAt = ts; }
        }
      }
      if (failed && !isSpawn(d.tool_name)) log(s, ts, agent ? agent.type : 'main', `工具失败：${toolLabel(d.tool_name, d.tool_input)}`, 'bad');
      break;
    }
    case 'SubagentStart': {
      const a = agent || getAgent(s, d.agent_id || ('a' + ts), d.agent_type, ts);
      a.status = 'running'; a.startedAt = Math.min(a.startedAt, ts); a.taskId = s.task ? s.task.id : null;
      const typed = a.type !== '子代理';
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
      if (d.last_assistant_message) a.lastMessage = short(d.last_assistant_message, 400);
      if (d.agent_transcript_path) a.transcript = d.agent_transcript_path;
      const dur = Math.max(0, Math.round(ts - a.startedAt));
      if (!isHelper(a)) log(s, ts, a.type, `${a.status === 'failed' ? '出错结束' : a.status === 'stopped' ? '被中断' : '完成'} · 用时 ${fmtDur(dur)}`, a.status === 'done' ? 'good' : 'bad');
      break;
    }
    case 'Stop':
      s.status = 'idle'; s.currentTool = null;
      if (s.task && !s.task.endedAt) { s.task.endedAt = ts; s.tasksDone++; }
      log(s, ts, 'main', '本轮回复完成，等你下一步', 'session');
      break;
    case 'Notification':
      if (/permission|needs_input/.test(d.notification_type || d.message || '')) {
        s.status = 'needs-you';
        log(s, ts, 'main', '需要你确认：' + short(d.message, 50), 'warn');
      }
      break;
    case 'PostModelSwitch':
      if (d.to_model) { s.model = d.to_model; s.actualModel = null; }
      log(s, ts, 'main', `切换模型 → ${prettyModel(d.to_model)}`, 'info');
      break;
    case 'PostCompact':
      log(s, ts, 'main', '上下文已自动压缩', 'warn');
      break;
    // 以下为演示模式专用的模拟事件
    case 'DemoTranscript':
      if (d.model) s.actualModel = d.model;
      if (d.context) s.context = d.context;
      if (d.out) s.outTokens = d.out;
      break;
    case 'DemoRoute':
      s.route = { mode: 'auto', last: { reason: d.reason }, advisorCalls: s.advisor.calls };
      log(s, ts, 'router', d.text, 'route');
      break;
    case 'DemoAdvisor':
      s.advisor.calls++; s.advisor.last = d.text; s.advisor.lastAt = ts; s.advisor.moment = d.moment;
      log(s, ts, 'advisor', '顾问介入（' + (d.moment || '') + '）：' + short(d.text, 40), 'advisor');
      break;
  }
  changed();
}

function fmtDur(sec) {
  if (sec < 60) return sec + '秒';
  if (sec < 3600) return Math.floor(sec / 60) + '分' + (sec % 60 ? (sec % 60) + '秒' : '');
  return Math.floor(sec / 3600) + '小时' + Math.floor((sec % 3600) / 60) + '分';
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
    if (m.model && !String(m.model).startsWith('<')) s.actualModel = m.model;
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
      log(s, ts, 'advisor', '顾问介入', 'advisor');
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

function onAgentTranscript(a, o) {
  const m = o.message;
  if (o.type === 'assistant' && m && m.model && !String(m.model).startsWith('<')) a.actualModel = m.model;
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
    const by = d.phase === 'plan' ? '计划模式'
      : String(d.prompt || '').includes('本轮中途升档') ? '本轮中途升档'
      : { manual: '你指定', pin: '/route 固定', continue: '沿用上一轮', escalate: '自动升档', rule: '规则', haiku: 'Haiku 判断', fallback: '默认', guard: '保护', phase: '计划执行' }[d.source] || d.source;
    log(s, d.at / 1000, 'router', `选择 ${prettyModel(d.model)} · ${d.effort}（${by}：${d.reason}）`, 'route');
  }
  if (last) s.routeSeen = last.at / 1000;
  s.route = { mode: r.mode, last, advisorCalls: r.advisorCalls || 0, pendingDown: r.pendingDown || null };
  s.timeline.sort((a, b) => a.ts - b.ts);
  changed();
}

function pollTranscripts() {
  const t = now();
  for (const s of sessions.values()) {
    if (t - s.lastTs > IDLE_MIN * 60) continue;
    pollRouter(s);
    if (s.transcript) {
      const before = s.context + '|' + s.actualModel + '|' + s.advisor.calls + '|' + s.advisor.last;
      readNew(s.transcript, o => onTranscript(s, o), 6 * 1024 * 1024);
      if (before !== s.context + '|' + s.actualModel + '|' + s.advisor.calls + '|' + s.advisor.last) changed();
    }
    for (const a of s.agents.values()) {
      if (a.actualModel) continue;
      const guesses = [];
      if (a.transcript) guesses.push(a.transcript);
      if (s.transcript) {
        const dir = path.dirname(s.transcript);
        guesses.push(path.join(dir, s.id, 'subagents', `agent-${a.id}.jsonl`));
        guesses.push(path.join(dir, `agent-${a.id}.jsonl`));
      }
      for (const g of guesses) {
        if (readNew(g, o => onAgentTranscript(a, o), 2 * 1024 * 1024)) { if (a.actualModel) { changed(); break; } }
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
    id: s.id, project: path.basename(s.cwd || '') || '(未知项目)', cwd: s.cwd,
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
        modelSource: a.actualModel ? '实际运行' : a.spawnModel ? '派活时指定' : def.model ? 'agents 设置' : '继承主会话',
        effort: a.effort || def.effort || null, status: a.status, description: a.description,
        startedAt: a.startedAt, endedAt: a.endedAt, currentTool: a.currentTool, lastTool: a.lastTool, toolCount: a.toolCount,
        lastMessage: a.lastMessage, test: a.test };
    }),
    earlierAgents: all.length - shown.length, totalAgents: all.length,
    timeline: s.timeline.slice(-40),
  };
}

function snapshot() {
  const t = now();
  const list = [...sessions.values()]
    .filter(s => DEMO || t - s.lastTs < KEEP_HOURS * 3600)
    .sort((a, b) => b.lastTs - a.lastTs).slice(0, 20).map(view);
  return { now: t, demo: DEMO, settings: { model: prettyModel(settings.model), advisorModel: prettyModel(settings.advisorModel),
    advisorFamily: family(settings.advisorModel), effortLevel: settings.effortLevel },
    sessions: list, stats: { events: stats.events, badLines: stats.badLines } };
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
    console.log('日志已归档');
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
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
      if (err) { res.writeHead(500); res.end('index.html 不见了'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`✗ 端口 ${PORT} 已被占用。看板可能已经在运行了，直接打开 http://localhost:${PORT} 试试。`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ Claude Code 看板已启动${DEMO ? '（演示模式）' : ''}：http://localhost:${PORT}`);
  if (!DEMO) console.log('  数据来源：' + LOG);
});

#!/usr/bin/env node
// Claude Code 看板 · 安全地往 ~/.claude/settings.json 里加入 / 移除采集 hook
// 用法：node setup-hooks.js --install --node /path/to/node
//       node setup-hooks.js --remove
// 修改前一定先备份；原有的其他设置一行都不动。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const CAPTURE = path.join(os.homedir(), '.claude', 'viz', 'app', 'capture.js');
const MARK = '.claude/viz/app/capture.js';
const WIN = process.platform === 'win32';
const fwd = p => String(p).replace(/\\/g, '/');

// 有 matcher 的事件用 "*"（全部匹配），没有 matcher 的事件不写 matcher
const EVENTS = {
  SessionStart: false, SessionEnd: false, UserPromptSubmit: false,
  PreToolUse: true, PostToolUse: true, PostToolUseFailure: true,
  SubagentStart: true, SubagentStop: true, Stop: false,
  Notification: true, PostModelSwitch: false, PostCompact: false,
};

function load() {
  if (!fs.existsSync(SETTINGS)) return {};
  const text = fs.readFileSync(SETTINGS, 'utf8');
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch (e) {
    console.error('✗ 你的 settings.json 格式有错误（不是合法的 JSON），为了安全，没有做任何修改。');
    console.error('  文件位置：' + SETTINGS);
    console.error('  错误信息：' + e.message);
    process.exit(2);
  }
}

function backup() {
  if (!fs.existsSync(SETTINGS)) return null;
  // 第一次安装前的原始设置，永久保留一份，绝不覆盖
  const pristine = SETTINGS + '.before-agent-viz';
  if (!fs.existsSync(pristine)) fs.copyFileSync(SETTINGS, pristine);
  // 每次修改前再存一份带时间的备份
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace('.', '').slice(0, 17);
  let dest = SETTINGS + '.bak-' + stamp, n = 1;
  while (fs.existsSync(dest)) dest = SETTINGS + '.bak-' + stamp + '-' + (n++);
  fs.copyFileSync(SETTINGS, dest);
  return dest;
}

function isOurs(h) { return h && typeof h.command === 'string' && fwd(h.command).includes(MARK); }

function install(nodePath) {
  const s = load();
  const bak = backup();
  s.hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  // Windows 上用正斜杠，命令在 Git Bash 和 cmd 里都能跑
  const command = WIN ? `"${fwd(process.execPath)}" "${fwd(CAPTURE)}"` : `"${nodePath}" "${CAPTURE}"`;
  let added = 0;
  for (const [ev, hasMatcher] of Object.entries(EVENTS)) {
    const groups = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [];
    const already = groups.some(g => Array.isArray(g.hooks) && g.hooks.some(isOurs));
    if (already) {
      // 已安装过：只更新 node 路径
      for (const g of groups) for (const h of (g.hooks || [])) if (isOurs(h)) h.command = command;
    } else {
      const group = { hooks: [{ type: 'command', command, async: true }] };
      if (hasMatcher) group.matcher = '*';
      groups.push(group);
      added++;
    }
    s.hooks[ev] = groups;
  }
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  if (bak) console.log('✓ 已备份原设置到 ' + bak);
  console.log(added ? `✓ 已加入 ${added} 个采集事件（全部为后台异步，不会拖慢 Claude Code）`
                    : '✓ 采集事件之前已经装过，已更新为最新路径');
}

function remove() {
  const s = load();
  if (!s.hooks) { console.log('✓ 设置里没有看板的采集事件，无需移除'); return; }
  const bak = backup();
  let removed = 0;
  for (const ev of Object.keys(s.hooks)) {
    const groups = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [];
    const kept = [];
    for (const g of groups) {
      const before = (g.hooks || []).length;
      const hs = (g.hooks || []).filter(h => !isOurs(h));
      removed += before - hs.length;
      if (hs.length) kept.push({ ...g, hooks: hs });
    }
    if (kept.length) s.hooks[ev] = kept; else delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  if (bak) console.log('✓ 已备份原设置到 ' + bak);
  console.log(`✓ 已移除 ${removed} 个看板采集事件，其他设置未改动`);
}

if (args.includes('--remove')) remove();
else if (args.includes('--install')) {
  const i = args.indexOf('--node');
  const nodePath = i >= 0 && args[i + 1] ? args[i + 1] : process.execPath;
  install(nodePath);
} else {
  console.log('用法：node setup-hooks.js --install [--node 路径] | --remove');
}

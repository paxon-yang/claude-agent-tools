#!/usr/bin/env node
// Claude Code 看板 · 采集脚本
// Claude Code 每发生一个动作，就把这个动作的信息交给本脚本；
// 本脚本只做一件事：把它追加成一行，写进 ~/.claude/viz/events.jsonl，然后立刻退出。
// 不联网、不修改任何别的文件。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG = path.join(os.homedir(), '.claude', 'viz', 'events.jsonl');

// 超长文字只保留开头和结尾，防止文件暴涨（测试结果通常在结尾，所以结尾多留一些）
function trim(v, depth) {
  if (typeof v === 'string') {
    return v.length > 2400 ? v.slice(0, 800) + ' …[truncated]… ' + v.slice(-1400) : v;
  }
  if (depth > 6) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => trim(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = trim(v[k], depth + 1);
    return out;
  }
  return v;
}

let raw = '';
const timer = setTimeout(() => process.exit(0), 5000); // 保险：最多 5 秒
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  try {
    if (raw.trim()) {
      const data = JSON.parse(raw);
      const line = JSON.stringify({ ts: Date.now() / 1000, data: trim(data, 0) }) + '\n';
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      fs.appendFileSync(LOG, line);
    }
  } catch (e) { /* 采集失败也绝不影响 Claude Code */ }
  clearTimeout(timer);
  process.exit(0);
});

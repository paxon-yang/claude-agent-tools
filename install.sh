#!/bin/bash
# 一次装好两个工具：自动选模型（auto-router）+ 代理看板（agent-viz）
# Installs both tools: automatic model routing (auto-router) + the agent dashboard (agent-viz)
# 用法 / usage: bash ~/claude-agent-tools/install.sh
DIR="$(cd "$(dirname "$0")" && pwd)"

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"   # 子安装脚本用同一种语言 / child installers use the same language
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # usage: echo "$(t '中文' 'English')"

bash "$DIR/auto-router/install.sh" || { echo "$(t 'auto-router 安装失败，上面有原因' 'auto-router install failed; see the reason above')"; exit 1; }
echo ""
bash "$DIR/agent-viz/install.sh" || { echo "$(t 'agent-viz 安装失败，上面有原因' 'agent-viz install failed; see the reason above')"; exit 1; }
echo ""
echo "$(t '两个都装好了。关掉所有 Claude Code，重新打开就生效。' 'Both tools are installed. Quit every Claude Code session and open it again to take effect.')"

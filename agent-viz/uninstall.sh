#!/bin/bash
# Claude Code 代理看板 · 卸载
# 用法：bash ~/.claude/viz/app/uninstall.sh
# 会做：停止后台服务 → 删除开机自启项 → 从 settings.json 移除看板的采集设置（先备份）
# 不会删除：~/.claude/viz 文件夹里的程序和已采集的记录（想删可以在访达里手动删）
# Claude Code Agent Board · uninstall: stops the service, removes the login item and the capture hooks (settings are
# backed up first). Your files in ~/.claude/viz are left in place.

LABEL="local.claude-agent-viz"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/.claude/viz/app"

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # echo "$(t '中文' 'English')"

echo ""
echo "$(t '=== Claude Code 代理看板 · 卸载 ===' '=== Claude Code Agent Board · Uninstall ===')"
case "$(uname -s)" in
  Darwin)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1
    [ -f "$PLIST" ] && rm "$PLIST" ;;
  MINGW*|MSYS*|CYGWIN*)
    rm -f "$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup/claude-agent-viz.vbs"
    [ -f "$HOME/.claude/viz/server.pid" ] && taskkill //F //PID "$(cat "$HOME/.claude/viz/server.pid")" >/dev/null 2>&1
    rm -f "$HOME/.claude/viz/server.pid" ;;
esac
echo "  ✓ $(t '后台服务已停止，开机不再自动运行' "Background service stopped and won't start at login anymore")"
if command -v node >/dev/null 2>&1 && [ -f "$APP/setup-hooks.js" ]; then
  node "$APP/setup-hooks.js" --remove
fi
echo ""
echo "$(t "  程序和记录还留在 $HOME/.claude/viz ，不需要了可以手动删掉这个文件夹。" "  The app and its records are still in $HOME/.claude/viz — delete that folder if you no longer need it.")"
echo "$(t '  重新打开 Claude Code 后，采集就彻底停止了。' '  Capture stops completely once you restart Claude Code.')"
echo ""

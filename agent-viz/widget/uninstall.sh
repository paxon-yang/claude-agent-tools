#!/bin/bash
# Agent 卡片 · 卸载 / Agent Card · uninstall
VIZ="$HOME/.claude/viz"; DEST="$VIZ/widget"; LABEL="local.claude-agent-card"
case "${CAT_LANG:-}" in zh|en) L="$CAT_LANG";; *) case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) L=zh;; *) L=en;; esac;; esac
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
case "$(uname -s)" in
Darwin) launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1; rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"; rm -rf "$HOME/Applications/Agent 卡片.app" "$HOME/Applications/Agent Card.app" ;;
MINGW*|MSYS*|CYGWIN*)
  STARTUP="$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup"; [ -d "$STARTUP" ] || STARTUP="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/Startup"
  rm -f "$STARTUP/claude-agent-card.vbs"; [ -f "$VIZ/widget.pid" ] && taskkill //F //PID "$(cat "$VIZ/widget.pid")" >/dev/null 2>&1 ;;
esac
echo "  ✓ $(t '卡片已关闭，登录后不再自动打开' 'The card is closed and no longer opens at login')"
echo "  $(t "文件还在 $DEST，不需要可以删掉这个文件夹" "Files remain in $DEST; delete that folder if you like")"

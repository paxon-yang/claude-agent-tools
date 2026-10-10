#!/bin/bash
# auto-router · 卸载 / uninstall
detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # usage: echo "$(t '中文' 'English')"

echo ""
echo "$(t '=== auto-router · 卸载 ===' '=== auto-router · uninstall ===')"
claude plugin uninstall auto-router@paxon-local >/dev/null 2>&1 && echo "$(t '  ✓ 已从 Claude Code 卸载' '  ✓ Removed from Claude Code')" || echo "$(t '  ✓ 没有安装，无需卸载' '  ✓ Not installed; nothing to remove')"
claude plugin marketplace remove paxon-local >/dev/null 2>&1
CMD="$HOME/.claude/CLAUDE.md"
if [ -f "$CMD" ] && grep -q "auto-router:start" "$CMD"; then
  cp "$CMD" "$CMD.bak-auto-router-uninstall"
  awk '/auto-router:start/{skip=1} !skip{print} /auto-router:end/{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
  echo "$(t '  ✓ 已从 ~/.claude/CLAUDE.md 移除派活规则（移除前备份为 CLAUDE.md.bak-auto-router-uninstall）' '  ✓ Removed the delegation rules from ~/.claude/CLAUDE.md (backup saved as CLAUDE.md.bak-auto-router-uninstall)')"
fi
echo "$(t '  ~/.claude/agents 里的子代理文件保留不动，不需要可以手动删除。' '  Sub-agent files in ~/.claude/agents are left in place; delete them by hand if you no longer need them.')"
echo "$(t "  文件还在 $HOME/.claude/auto-router，不需要可以手动删掉。" "  The plugin files remain in $HOME/.claude/auto-router; delete them by hand if you like.")"
echo "$(t '  重开 Claude Code 后，就回到 /model 里设置的固定模型。' '  After restarting Claude Code, the fixed model set in /model is used again.')"
echo ""

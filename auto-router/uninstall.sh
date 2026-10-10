#!/bin/bash
# auto-router · 卸载
echo ""
echo "=== auto-router · 卸载 ==="
claude plugin uninstall auto-router@paxon-local >/dev/null 2>&1 && echo "  ✓ 已从 Claude Code 卸载" || echo "  ✓ 没有安装，无需卸载"
claude plugin marketplace remove paxon-local >/dev/null 2>&1
CMD="$HOME/.claude/CLAUDE.md"
if [ -f "$CMD" ] && grep -q "auto-router:start" "$CMD"; then
  cp "$CMD" "$CMD.bak-auto-router-uninstall"
  awk '/auto-router:start/{skip=1} !skip{print} /auto-router:end/{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
  echo "  ✓ 已从 ~/.claude/CLAUDE.md 移除派活规则（移除前备份为 CLAUDE.md.bak-auto-router-uninstall）"
fi
echo "  ~/.claude/agents 里的子代理文件保留不动，不需要可以手动删除。"
echo "  文件还在 $HOME/.claude/auto-router，不需要可以手动删掉。"
echo "  重开 Claude Code 后，就回到 /model 里设置的固定模型。"
echo ""

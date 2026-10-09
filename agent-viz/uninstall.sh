#!/bin/bash
# Claude Code 代理看板 · 卸载
# 用法：bash ~/.claude/viz/app/uninstall.sh
# 会做：停止后台服务 → 删除开机自启项 → 从 settings.json 移除看板的采集设置（先备份）
# 不会删除：~/.claude/viz 文件夹里的程序和已采集的记录（想删可以在访达里手动删）

LABEL="local.claude-agent-viz"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/.claude/viz/app"

echo ""
echo "=== Claude Code 代理看板 · 卸载 ==="
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1
[ -f "$PLIST" ] && rm "$PLIST"
echo "  ✓ 后台服务已停止，开机不再自动运行"
if command -v node >/dev/null 2>&1 && [ -f "$APP/setup-hooks.js" ]; then
  node "$APP/setup-hooks.js" --remove
fi
echo ""
echo "  程序和记录还留在 $HOME/.claude/viz ，不需要了可以在访达里删掉这个文件夹。"
echo "  重新打开 Claude Code 后，采集就彻底停止了。"
echo ""

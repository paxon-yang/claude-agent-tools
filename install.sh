#!/bin/bash
# 一次装好两个工具：自动选模型（auto-router）+ 代理看板（agent-viz）
# 用法：bash ~/claude-agent-tools/install.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/auto-router/install.sh" || { echo "auto-router 安装失败，上面有原因"; exit 1; }
echo ""
bash "$DIR/agent-viz/install.sh" || { echo "agent-viz 安装失败，上面有原因"; exit 1; }
echo ""
echo "两个都装好了。关掉所有 Claude Code，重新打开就生效。"

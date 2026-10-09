#!/bin/bash
# 更新到最新版并重新安装（你改过的 config.json 会保留）
# 用法：bash ~/claude-agent-tools/update.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
git pull --ff-only || { echo "拉取更新失败：如果你改过这个文件夹里的文件，先把改动发给 Claude 处理"; exit 1; }
bash "$DIR/install.sh"

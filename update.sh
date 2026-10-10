#!/bin/bash
# 更新到最新版并重新安装（你改过的 config.json 会保留）
# Update to the latest version and reinstall (your edited config.json is kept)
# 用法 / usage: bash ~/claude-agent-tools/update.sh
DIR="$(cd "$(dirname "$0")" && pwd)"

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # usage: echo "$(t '中文' 'English')"

cd "$DIR" || exit 1
git pull --ff-only || { echo "$(t '拉取更新失败：如果你改过这个文件夹里的文件，先把改动发给 Claude 处理' 'Pulling the update failed: if you changed files in this folder, ask Claude to sort out those changes first')"; exit 1; }
bash "$DIR/install.sh"

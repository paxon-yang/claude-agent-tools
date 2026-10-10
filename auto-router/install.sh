#!/bin/bash
# auto-router · 一键安装：让 Claude Code 每一轮自动选模型
# auto-router · one-step install: let Claude Code pick the model for every turn
# 用法 / usage: bash ~/claude-agent-tools/install.sh
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/auto-router"

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # usage: echo "$(t '中文' 'English')"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

echo ""
echo "$(t '=== auto-router · 自动选模型 · 安装 ===' '=== auto-router · automatic model routing · install ===')"
echo ""
echo "$(t '[1/4] 检查 Claude Code' '[1/4] Checking Claude Code')"
command -v claude >/dev/null 2>&1 || fail "$(t '没找到 claude 命令。请先安装 Claude Code，再运行本脚本。' 'The claude command was not found. Install Claude Code first, then run this script again.')"
CV="$(claude --version 2>/dev/null | head -1)"
NUM="$(echo "$CV" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
ok "Claude Code $CV"
if [ -n "$NUM" ]; then
  OLD="$(printf '%s\n' "$NUM" | awk -F. '{ if ($1<2 || ($1==2 && $2<1) || ($1==2 && $2==1 && $3<288)) print 1; else print 0 }')"
  if [ "$OLD" = "1" ]; then
    warn "$(t '版本低于 2.1.288（这个插件是在 2.1.288 上测试的），先自动升级……' 'Version is below 2.1.288 (this plugin was tested on 2.1.288); updating first...')"
    claude update || fail "$(t '升级失败。请手动运行  claude update  后再安装。' 'Update failed. Run  claude update  manually, then install again.')"
  fi
fi

echo ""
echo "$(t "[2/4] 复制插件到 $DEST" "[2/4] Copying the plugin to $DEST")"
mkdir -p "$DEST" || fail "$(t "无法创建 $DEST" "Could not create $DEST")"
if [ "$SRC" != "$DEST" ]; then
  KEEP=""
  [ -f "$DEST/config.json" ] && KEEP="$(cat "$DEST/config.json")"
  cp -R "$SRC/." "$DEST/" || fail "$(t '复制失败' 'Copy failed')"
  if [ -n "$KEEP" ]; then
    if printf '%s' "$KEEP" | grep -q '"executeTier"'; then
      printf '%s\n' "$KEEP" > "$DEST/config.json"; ok "$(t '保留了你改过的 config.json' 'Kept your existing config.json')"
      # 旧版默认值换成新版默认值（只改从没被你改过的那几项）
      # Replace old defaults with new ones (only keys you never changed); never touch an existing "lang"
      node -e '
        const fs = require("fs"), p = process.argv[1], zh = process.argv[2] === "zh";
        const c = JSON.parse(fs.readFileSync(p, "utf8")); const msg = []; let out = c;
        if (c.noDowngradeAboveTokens === 80000) { c.noDowngradeAboveTokens = null; msg.push(zh ? "长对话也允许降档" : "downgrades allowed in long conversations"); }
        if (c.subagents) for (const k of ["worker", "general-purpose"]) if (c.subagents[k] === "main") { c.subagents[k] = "sonnet"; msg.push(zh ? k + " 子代理改用 Sonnet" : k + " sub-agent now uses Sonnet"); }
        if (!("handbackTier" in c)) { c.handbackTier = "sonnet"; msg.push(zh ? "子代理交回结果用 Sonnet 汇总" : "sub-agent hand-backs summarized by Sonnet"); }
        // Everyone who installed before i18n used the Chinese UI: keep it Chinese
        if (!("lang" in c)) { out = { lang: "zh", ...c }; msg.push(zh ? "界面语言保持中文（config.json 里 \"lang\" 可改成 \"en\"）" : "UI language kept as Chinese (set \"lang\": \"en\" in config.json to switch)"); }
        if (msg.length) { fs.writeFileSync(p, JSON.stringify(out, null, 2) + "\n"); console.log((zh ? "  ✓ 设置已更新：" : "  ✓ Settings updated: ") + msg.join(zh ? "、" : "; ")); }
      ' "$DEST/config.json" "$L" || warn "$(t '设置迁移没成功，不影响使用' 'Settings migration failed; the plugin still works')"
    else
      printf '%s\n' "$KEEP" > "$DEST/config.json.v0.1-backup"
      # v0.1 用户（中文界面时代）换成新版默认设置，语言保持中文 / v0.1 users predate i18n: keep Chinese
      sed 's/"lang": *"[a-z]*"/"lang": "zh"/' "$DEST/config.json" > "$DEST/config.json.tmp" && mv "$DEST/config.json.tmp" "$DEST/config.json"
      ok "$(t '旧版 config.json 已换成新版默认设置（旧的备份为 config.json.v0.1-backup）' 'Old config.json replaced with the new defaults (backup saved as config.json.v0.1-backup)')"
    fi
  else
    # 全新安装：界面语言用检测到的语言 / fresh install: UI language = detected language
    sed "s/\"lang\": *\"[a-z]*\"/\"lang\": \"$L\"/" "$DEST/config.json" > "$DEST/config.json.tmp" && mv "$DEST/config.json.tmp" "$DEST/config.json"
  fi
fi
ok "$(t '插件文件已就位' 'Plugin files in place')"

# 派活规则和子代理模板跟着 config.json 的语言走 / templates follow the config's language
CFG_LANG=en
grep -q '"lang"[[:space:]]*:[[:space:]]*"zh"' "$DEST/config.json" 2>/dev/null && CFG_LANG=zh
if [ "$CFG_LANG" = zh ]; then TPL="$DEST/templates"; else TPL="$DEST/templates/en"; fi

echo ""
echo "$(t '[3/4] 安装到 Claude Code（对你所有项目生效）' '[3/4] Installing into Claude Code (applies to all your projects)')"
# Windows（Git Bash）上 claude.exe 要用 C:\... 这种路径
DEST_NATIVE="$DEST"
command -v cygpath >/dev/null 2>&1 && DEST_NATIVE="$(cygpath -w "$DEST")"
claude plugin marketplace add "$DEST_NATIVE" >/dev/null 2>&1 || claude plugin marketplace update paxon-local >/dev/null 2>&1
if claude plugin install auto-router@paxon-local --scope user >/tmp/auto-router-install.log 2>&1; then
  ok "$(t '已安装并启用' 'Installed and enabled')"
else
  if claude plugin list 2>/dev/null | grep -q "auto-router@paxon-local"; then
    claude plugin enable auto-router@paxon-local >/dev/null 2>&1
    ok "$(t '之前已经装过，已更新并启用' 'Already installed; updated and enabled')"
  else
    cat /tmp/auto-router-install.log
    fail "$(t '安装失败，原因见上面。把这段文字发给 Claude。' 'Install failed; see the output above. Paste it to Claude for help.')"
  fi
fi

echo ""
echo "$(t '[4/4] 派活规则和子代理' '[4/4] Delegation rules and sub-agents')"
CMD="$HOME/.claude/CLAUDE.md"
[ -f "$CMD" ] && cp "$CMD" "$CMD.bak-auto-router"
if [ -f "$CMD" ] && grep -q "auto-router:start" "$CMD"; then
  awk '/auto-router:start/{skip=1} !skip{print} /auto-router:end/{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
fi
{ [ -s "$CMD" ] && echo ""; cat "$TPL/CLAUDE-block.md"; } >> "$CMD"
ok "$(t '已在 ~/.claude/CLAUDE.md 末尾写入派活规则（原文件备份为 CLAUDE.md.bak-auto-router）' 'Added delegation rules to the end of ~/.claude/CLAUDE.md (original backed up as CLAUDE.md.bak-auto-router)')"
mkdir -p "$HOME/.claude/agents"
for a in explorer researcher worker quick-worker; do
  if [ -f "$HOME/.claude/agents/$a.md" ]; then
    ok "$(t "子代理 $a 已存在，保留你自己的版本" "Sub-agent $a already exists; keeping your version")"
  else
    cp "$TPL/agents/$a.md" "$HOME/.claude/agents/$a.md" && ok "$(t "已创建子代理 $a" "Created sub-agent $a")"
  fi
done

echo ""
echo "$(t '=== 安装完成 ===' '=== Install complete ===')"
echo ""
echo "$(t '  1. 关掉所有正在运行的 Claude Code，重新打开' '  1. Quit every running Claude Code session and open it again')"
echo "$(t '  2. 在 Claude Code 里输入  /route  查看状态，/route rules 查看规则' '  2. In Claude Code, type  /route  for status and  /route rules  for the rules')"
echo "$(t '  3. 想让 Fable 当顾问：输入  /model fable  同意一次，再输入  /advisor fable' '  3. To use Fable as the advisor: type  /model fable  and accept once, then  /advisor fable')"
echo "$(t "  卸载：bash \"$DEST/uninstall.sh\"" "  Uninstall: bash \"$DEST/uninstall.sh\"")"
echo ""

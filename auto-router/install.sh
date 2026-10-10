#!/bin/bash
# auto-router · 一键安装：让 Claude Code 每一轮自动选模型
# 用法：bash ~/claude-agent-tools/install.sh
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/auto-router"
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

echo ""
echo "=== auto-router · 自动选模型 · 安装 ==="
echo ""
echo "[1/4] 检查 Claude Code"
command -v claude >/dev/null 2>&1 || fail "没找到 claude 命令。请先安装 Claude Code，再运行本脚本。"
CV="$(claude --version 2>/dev/null | head -1)"
NUM="$(echo "$CV" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
ok "Claude Code $CV"
if [ -n "$NUM" ]; then
  OLD="$(printf '%s\n' "$NUM" | awk -F. '{ if ($1<2 || ($1==2 && $2<1) || ($1==2 && $2==1 && $3<288)) print 1; else print 0 }')"
  if [ "$OLD" = "1" ]; then
    warn "版本低于 2.1.288（这个插件是在 2.1.288 上测试的），先自动升级……"
    claude update || fail "升级失败。请手动运行  claude update  后再安装。"
  fi
fi

echo ""
echo "[2/4] 复制插件到 $DEST"
mkdir -p "$DEST" || fail "无法创建 $DEST"
if [ "$SRC" != "$DEST" ]; then
  KEEP=""
  [ -f "$DEST/config.json" ] && KEEP="$(cat "$DEST/config.json")"
  cp -R "$SRC/." "$DEST/" || fail "复制失败"
  if [ -n "$KEEP" ]; then
    if printf '%s' "$KEEP" | grep -q '"executeTier"'; then
      printf '%s\n' "$KEEP" > "$DEST/config.json"; ok "保留了你改过的 config.json"
      # 旧版默认值换成新版默认值（只改从没被你改过的那几项）
      node -e '
        const fs = require("fs"), p = process.argv[1]; const c = JSON.parse(fs.readFileSync(p, "utf8")); const msg = [];
        if (c.noDowngradeAboveTokens === 80000) { c.noDowngradeAboveTokens = null; msg.push("长对话也允许降档"); }
        if (c.subagents) for (const k of ["worker", "general-purpose"]) if (c.subagents[k] === "main") { c.subagents[k] = "sonnet"; msg.push(k + " 子代理改用 Sonnet"); }
        if (!("handbackTier" in c)) { c.handbackTier = "sonnet"; msg.push("子代理交回结果用 Sonnet 汇总"); }
        if (msg.length) { fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n"); console.log("  ✓ 设置已更新：" + msg.join("、")); }
      ' "$DEST/config.json" || warn "设置迁移没成功，不影响使用"
    else
      printf '%s\n' "$KEEP" > "$DEST/config.json.v0.1-backup"
      ok "旧版 config.json 已换成新版默认设置（旧的备份为 config.json.v0.1-backup）"
    fi
  fi
fi
ok "插件文件已就位"

echo ""
echo "[3/4] 安装到 Claude Code（对你所有项目生效）"
# Windows（Git Bash）上 claude.exe 要用 C:\... 这种路径
DEST_NATIVE="$DEST"
command -v cygpath >/dev/null 2>&1 && DEST_NATIVE="$(cygpath -w "$DEST")"
claude plugin marketplace add "$DEST_NATIVE" >/dev/null 2>&1 || claude plugin marketplace update paxon-local >/dev/null 2>&1
if claude plugin install auto-router@paxon-local --scope user >/tmp/auto-router-install.log 2>&1; then
  ok "已安装并启用"
else
  if claude plugin list 2>/dev/null | grep -q "auto-router@paxon-local"; then
    claude plugin enable auto-router@paxon-local >/dev/null 2>&1
    ok "之前已经装过，已更新并启用"
  else
    cat /tmp/auto-router-install.log
    fail "安装失败，原因见上面。把这段文字发给 Claude。"
  fi
fi

echo ""
echo "[4/4] 派活规则和子代理"
CMD="$HOME/.claude/CLAUDE.md"
[ -f "$CMD" ] && cp "$CMD" "$CMD.bak-auto-router"
if [ -f "$CMD" ] && grep -q "auto-router:start" "$CMD"; then
  awk '/auto-router:start/{skip=1} !skip{print} /auto-router:end/{skip=0}' "$CMD" > "$CMD.tmp" && mv "$CMD.tmp" "$CMD"
fi
{ [ -s "$CMD" ] && echo ""; cat "$DEST/templates/CLAUDE-block.md"; } >> "$CMD"
ok "已在 ~/.claude/CLAUDE.md 末尾写入派活规则（原文件备份为 CLAUDE.md.bak-auto-router）"
mkdir -p "$HOME/.claude/agents"
for a in explorer researcher worker quick-worker; do
  if [ -f "$HOME/.claude/agents/$a.md" ]; then
    ok "子代理 $a 已存在，保留你自己的版本"
  else
    cp "$DEST/templates/agents/$a.md" "$HOME/.claude/agents/$a.md" && ok "已创建子代理 $a"
  fi
done

echo ""
echo "=== 安装完成 ==="
echo ""
echo "  1. 关掉所有正在运行的 Claude Code，重新打开"
echo "  2. 在 Claude Code 里输入  /route  查看状态，/route rules 查看规则"
echo "  3. 想让 Fable 当顾问：输入  /model fable  同意一次，再输入  /advisor fable"
echo "  卸载：bash \"$DEST/uninstall.sh\""
echo ""

#!/bin/bash
# Claude Code 代理看板 · 一键安装
# 用法：在终端里进入本文件夹，运行  bash install.sh
# 它会做 4 件事：
#   1. 把看板程序复制到  ~/.claude/viz/app
#   2. 在 ~/.claude/settings.json 里加入采集设置（先自动备份，原有设置一行不动）
#   3. 把看板注册成开机自动运行的后台服务
#   4. 打开浏览器  http://localhost:4321

SRC="$(cd "$(dirname "$0")" && pwd)"
VIZ="$HOME/.claude/viz"
APP="$VIZ/app"
LABEL="local.claude-agent-viz"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=4321

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

echo ""
echo "=== Claude Code 代理看板 · 安装 ==="
echo ""
echo "[1/4] 检查电脑环境"

NODE="$(command -v node)"
[ -z "$NODE" ] && fail "没找到 Node.js。请先到 https://nodejs.org 下载左边的 LTS 版本，双击安装，然后关掉终端重新打开，再运行一次本脚本。"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -lt 18 ] && fail "Node.js 版本太旧（$("$NODE" -v)），需要 18 或以上。请到 https://nodejs.org 安装新版。"
ok "Node.js $("$NODE" -v)"

if command -v claude >/dev/null 2>&1; then
  CV="$(claude --version 2>/dev/null | head -1)"
  ok "Claude Code $CV"
  NUM="$(echo "$CV" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -n "$NUM" ]; then
    OLD="$("$NODE" -e 'const a=process.argv[1].split(".").map(Number),b=[2,1,284];for(let i=0;i<3;i++){if(a[i]!==b[i]){console.log(a[i]<b[i]?1:0);process.exit()}}console.log(0)' "$NUM")"
    [ "$OLD" = "1" ] && warn "Claude Code 版本偏旧，建议先运行  claude update  再继续（不升级看板也能用，但子代理信息可能不全）"
  fi
else
  warn "没找到 claude 命令。看板照样能装好，但要等你用 Claude Code 时才会有数据。"
fi

[ -f "$SRC/server.js" ] || fail "安装包不完整：没找到 server.js。请确认你是在解压后的 agent-viz 文件夹里运行的。"

echo ""
echo "[2/4] 复制看板程序到 $APP"
mkdir -p "$APP/public" || fail "无法创建文件夹 $APP"
if [ "$SRC" != "$APP" ]; then
  cp "$SRC/server.js" "$SRC/capture.js" "$SRC/setup-hooks.js" "$SRC/install.sh" "$SRC/uninstall.sh" "$SRC/cloudflare.sh" "$SRC/demo-events.jsonl" "$APP/" || fail "复制文件失败"
  cp "$SRC/public/index.html" "$APP/public/" || fail "复制网页文件失败"
  if [ -f "$APP/config.json" ]; then ok "保留你已有的 config.json"; else cp "$SRC/config.json" "$APP/"; fi
  ok "程序已就位"
else
  ok "从已安装的位置重新安装，程序文件不用复制"
fi

echo ""
echo "[3/4] 加入采集设置（~/.claude/settings.json）"
NODE_HOOK="$NODE"
command -v cygpath >/dev/null 2>&1 && NODE_HOOK="$(cygpath -m "$NODE")"
"$NODE" "$APP/setup-hooks.js" --install --node "$NODE_HOOK" || fail "修改设置失败，上面有原因。你的设置没有被改动。"

echo ""
echo "[4/4] 注册为开机自动运行的后台服务"
wait_up() {
  OKUP=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 0.6
    if curl -s "http://localhost:$PORT/api/health" | grep -q '"ok":true'; then OKUP=1; break; fi
  done
}
case "$(uname -s)" in
Darwin)
  mkdir -p "$HOME/Library/LaunchAgents"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$APP/server.js</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$VIZ/server.log</string>
  <key>StandardErrorPath</key><string>$VIZ/server.log</string>
</dict>
</plist>
EOF
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
    launchctl load -w "$PLIST" >/dev/null 2>&1
  fi
  wait_up
  if [ -n "$OKUP" ]; then ok "看板服务已在后台运行，以后开机会自动启动"
  else warn "看板服务没能启动。请把这个文件的最后几行发给 Claude：$VIZ/server.log"; fi
  ;;
MINGW*|MSYS*|CYGWIN*)
  # Windows：放一个隐藏运行的启动脚本到"启动"文件夹，开机登录后自动运行
  STARTUP="$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup"
  [ -d "$STARTUP" ] || STARTUP="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/Startup"
  VBS="$STARTUP/claude-agent-viz.vbs"
  NODEX="$NODE"; [ -f "$NODE.exe" ] && NODEX="$NODE.exe"
  WNODE="$(cygpath -w "$NODEX")"; WAPP="$(cygpath -w "$APP")"; WLOG="$(cygpath -w "$VIZ/server.log")"
  if [ -f "$VIZ/server.pid" ]; then taskkill //F //PID "$(cat "$VIZ/server.pid")" >/dev/null 2>&1; rm -f "$VIZ/server.pid"; sleep 1; fi
  mkdir -p "$STARTUP"
  cat > "$VBS" <<EOF
' Claude Code 代理看板：登录 Windows 后在后台启动（没有窗口）
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$WAPP"
sh.Run "cmd /c """"$WNODE"" ""$WAPP\server.js"" >> ""$WLOG"" 2>&1""", 0, False
EOF
  wscript.exe "$(cygpath -w "$VBS")" >/dev/null 2>&1 &
  wait_up
  if [ -n "$OKUP" ]; then ok "看板服务已在后台运行，以后登录 Windows 会自动启动"
  else warn "看板服务没能启动。请把这个文件的最后几行发给 Claude：$VIZ/server.log"; fi
  ;;
*)
  warn "这个系统不支持开机自启，请手动启动看板：  node \"$APP/server.js\""
  ;;
esac

echo ""
echo "=== 安装完成 ==="
echo ""
echo "  看板地址：  http://localhost:$PORT"
echo "  下一步：    关掉所有正在运行的 Claude Code，重新打开，看板就会开始有数据。"
echo "  想先看效果：node \"$APP/server.js\" --demo --port 4322   然后打开 http://localhost:4322"
echo "  卸载：      bash \"$APP/uninstall.sh\""
echo ""
if [ -n "$OKUP" ]; then
  case "$(uname -s)" in
    Darwin) open "http://localhost:$PORT" ;;
    MINGW*|MSYS*|CYGWIN*) cmd //c start "" "http://localhost:$PORT" >/dev/null 2>&1 ;;
  esac
fi
exit 0

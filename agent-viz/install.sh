#!/bin/bash
# Claude Code 代理看板 · 一键安装
# 用法：在终端里进入本文件夹，运行  bash install.sh
# 它会做 4 件事：
#   1. 把看板程序复制到  ~/.claude/viz/app
#   2. 在 ~/.claude/settings.json 里加入采集设置（先自动备份，原有设置一行不动）
#   3. 把看板注册成开机自动运行的后台服务
#   4. 打开浏览器  http://localhost:4321
# Claude Code Agent Board · one-step install: copies the app to ~/.claude/viz/app, adds the capture hooks to
# ~/.claude/settings.json (backed up first), registers a login service, and opens http://localhost:4321.
# Messages follow CAT_LANG=en|zh, else your system language.

SRC="$(cd "$(dirname "$0")" && pwd)"
VIZ="$HOME/.claude/viz"
APP="$VIZ/app"
LABEL="local.claude-agent-viz"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=4321

detect_lang() {
  case "${CAT_LANG:-}" in zh|en) echo "$CAT_LANG"; return;; esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in zh*) echo zh; return;; esac
  if [ "$(uname -s)" = Darwin ] && defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n"(' | grep -q '^zh'; then echo zh; return; fi
  echo en
}
L="$(detect_lang)"; export CAT_LANG="$L"
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }   # echo "$(t '中文' 'English')"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

# launchd：先等旧服务真正退出，再注册新的；注册失败就重试几次（bootout 后立刻 bootstrap 常报 "Input/output error"）
# launchd: wait for the old job to go away, then register; retry, since bootstrap right after bootout often fails
la_stop() { launchctl bootout "gui/$(id -u)/$1" >/dev/null 2>&1; for _ in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 || return 0; sleep 0.5; done; }
la_start() {
  for _ in 1 2 3 4 5; do
    launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 && { launchctl kickstart "gui/$(id -u)/$1" >/dev/null 2>&1; return 0; }
    launchctl bootstrap "gui/$(id -u)" "$2" >/dev/null 2>&1 || launchctl load -w "$2" >/dev/null 2>&1
    sleep 1
  done
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

echo ""
echo "$(t '=== Claude Code 代理看板 · 安装 ===' '=== Claude Code Agent Board · Install ===')"
echo ""
echo "$(t '[1/4] 检查电脑环境' '[1/4] Checking your system')"

NODE="$(command -v node)"
[ -z "$NODE" ] && fail "$(t '没找到 Node.js。请先到 https://nodejs.org 下载左边的 LTS 版本，双击安装，然后关掉终端重新打开，再运行一次本脚本。' "Node.js not found. Download the LTS version from https://nodejs.org, install it, then reopen your terminal and run this script again.")"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -lt 18 ] && fail "$(t "Node.js 版本太旧（$("$NODE" -v)），需要 18 或以上。请到 https://nodejs.org 安装新版。" "Node.js $("$NODE" -v) is too old — version 18 or later is required. Get the latest from https://nodejs.org.")"
ok "Node.js $("$NODE" -v)"

if command -v claude >/dev/null 2>&1; then
  CV="$(claude --version 2>/dev/null | head -1)"
  ok "Claude Code $CV"
  NUM="$(echo "$CV" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -n "$NUM" ]; then
    OLD="$("$NODE" -e 'const a=process.argv[1].split(".").map(Number),b=[2,1,284];for(let i=0;i<3;i++){if(a[i]!==b[i]){console.log(a[i]<b[i]?1:0);process.exit()}}console.log(0)' "$NUM")"
    [ "$OLD" = "1" ] && warn "$(t 'Claude Code 版本偏旧，建议先运行  claude update  再继续（不升级看板也能用，但子代理信息可能不全）' "Your Claude Code is a bit old — consider running  claude update  first (the board still works, but subagent details may be incomplete)")"
  fi
else
  warn "$(t '没找到 claude 命令。看板照样能装好，但要等你用 Claude Code 时才会有数据。' "The claude command wasn't found. The board will still install, but it'll stay empty until you use Claude Code.")"
fi

[ -f "$SRC/server.js" ] || fail "$(t '安装包不完整：没找到 server.js。请确认你是在解压后的 agent-viz 文件夹里运行的。' "Incomplete package: server.js not found. Make sure you're running this from inside the agent-viz folder.")"

echo ""
echo "$(t "[2/4] 复制看板程序到 $APP" "[2/4] Copying the board to $APP")"
mkdir -p "$APP/public" || fail "$(t "无法创建文件夹 $APP" "Couldn't create folder $APP")"
if [ "$SRC" != "$APP" ]; then
  cp "$SRC/server.js" "$SRC/capture.js" "$SRC/setup-hooks.js" "$SRC/install.sh" "$SRC/uninstall.sh" "$SRC/cloudflare.sh" "$SRC/phone.sh" "$SRC/demo-events.jsonl" "$SRC/demo-events.en.jsonl" "$APP/" || fail "$(t '复制文件失败' 'Copying files failed')"
  if [ -f "$SRC/report.js" ]; then cp "$SRC/report.js" "$APP/" || fail "$(t '复制文件失败' 'Copying files failed')"; fi
  cp "$SRC/public/index.html" "$SRC/public/mini.html" "$APP/public/" || fail "$(t '复制网页文件失败' 'Copying the web page failed')"
  # 手机"添加到主屏幕"用的图标 / icons for "Add to Home Screen"
  for f in icon-192.png icon-512.png icon-maskable.png apple-touch-icon.png; do [ -f "$SRC/public/$f" ] && cp "$SRC/public/$f" "$APP/public/"; done
  # 已有的 config.json 原样保留（没有 "lang" 就是跟随系统语言）/ an existing config.json is kept as is (no "lang" = auto)
  if [ -f "$APP/config.json" ]; then ok "$(t '保留你已有的 config.json' 'Kept your existing config.json')"; else cp "$SRC/config.json" "$APP/"; fi
  ok "$(t '程序已就位' 'Files in place')"
else
  ok "$(t '从已安装的位置重新安装，程序文件不用复制' 'Reinstalling from the installed location — nothing to copy')"
fi

echo ""
echo "$(t '[3/4] 加入采集设置（~/.claude/settings.json）' '[3/4] Adding capture hooks (~/.claude/settings.json)')"
NODE_HOOK="$NODE"
command -v cygpath >/dev/null 2>&1 && NODE_HOOK="$(cygpath -m "$NODE")"
"$NODE" "$APP/setup-hooks.js" --install --node "$NODE_HOOK" || fail "$(t '修改设置失败，上面有原因。你的设置没有被改动。' "Couldn't update your settings (see the reason above). Nothing was changed.")"

echo ""
echo "$(t '[4/4] 注册为开机自动运行的后台服务' '[4/4] Registering a background service that starts at login')"
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
  la_stop "$LABEL"
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
  la_start "$LABEL" "$PLIST"
  wait_up
  if [ -n "$OKUP" ]; then ok "$(t '看板服务已在后台运行，以后开机会自动启动' "The board is running in the background and will start automatically at login")"
  else warn "$(t "看板服务没能启动。请把这个文件的最后几行发给 Claude：$VIZ/server.log" "The board didn't start. Send the last few lines of this file to Claude: $VIZ/server.log")"; fi
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
' Claude Code Agent Board: starts hidden in the background when you sign in to Windows
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$WAPP"
sh.Run "cmd /c """"$WNODE"" ""$WAPP\server.js"" >> ""$WLOG"" 2>&1""", 0, False
EOF
  wscript.exe "$(cygpath -w "$VBS")" >/dev/null 2>&1 &
  wait_up
  if [ -n "$OKUP" ]; then ok "$(t '看板服务已在后台运行，以后登录 Windows 会自动启动' "The board is running in the background and will start when you sign in to Windows")"
  else warn "$(t "看板服务没能启动。请把这个文件的最后几行发给 Claude：$VIZ/server.log" "The board didn't start. Send the last few lines of this file to Claude: $VIZ/server.log")"; fi
  ;;
*)
  warn "$(t "这个系统不支持开机自启，请手动启动看板：  node \"$APP/server.js\"" "Auto-start isn't supported on this system. Start the board yourself:  node \"$APP/server.js\"")"
  ;;
esac

echo ""
echo "$(t '=== 安装完成 ===' '=== Install complete ===')"
echo ""
echo "$(t '  看板地址：  ' '  Board:       ')http://localhost:$PORT"
echo "$(t '  下一步：    关掉所有正在运行的 Claude Code，重新打开，看板就会开始有数据。' '  Next:        Quit any running Claude Code sessions and start them again — data will start flowing in.')"
echo "$(t '  想先看效果：' '  Try a demo:  ')node \"$APP/server.js\" --demo --port 4322$(t '   然后打开 ' '   then open ')http://localhost:4322"
[ -f "$APP/report.js" ] && echo "$(t '  省了多少：  ' '  Savings:     ')node \"$APP/report.js\"$(t '   看看自动选模型帮你省了多少' '   See how much routing saved you')"
echo "$(t '  卸载：      ' '  Uninstall:   ')bash \"$APP/uninstall.sh\""
echo ""
if [ -n "$OKUP" ]; then
  case "$(uname -s)" in
    Darwin) open "http://localhost:$PORT" ;;
    MINGW*|MSYS*|CYGWIN*) cmd //c start "" "http://localhost:$PORT" >/dev/null 2>&1 ;;
  esac
fi
exit 0

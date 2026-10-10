#!/bin/bash
# Agent 卡片（桌面小窗口）· 安装：浮在桌面右上角，只显示现在最重要的东西
# Agent Card (desktop widget) · install: a small always-on-top window with what matters right now
# 用法 / usage:  bash ~/claude-agent-tools/agent-viz/widget/install.sh
SRC="$(cd "$(dirname "$0")" && pwd)"
VIZ="$HOME/.claude/viz"
DEST="$VIZ/widget"
LABEL="local.claude-agent-card"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

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
echo "$(t '=== Agent 卡片 · 桌面小窗口 · 安装 ===' '=== Agent Card · desktop widget · install ===')"
NODE="$(command -v node)"; NPM="$(command -v npm)"
[ -z "$NODE" ] || [ -z "$NPM" ] && fail "$(t '需要先装 Node.js（https://nodejs.org）' 'Node.js is required (https://nodejs.org)')"
curl -s "http://localhost:$(node -e "try{console.log(require('$VIZ/app/config.json').port||4321)}catch(e){console.log(4321)}")/api/health" | grep -q '"ok":true' \
  || warn "$(t '看板服务现在没在运行；卡片会一直等它启动。没装看板的话先运行 bash ~/claude-agent-tools/agent-viz/install.sh' "The board isn't running right now; the card will wait for it. If you haven't installed it: bash ~/claude-agent-tools/agent-viz/install.sh")"

echo ""
echo "$(t '[1/3] 复制文件' '[1/3] Copying files')"
mkdir -p "$DEST" || fail "$(t "无法创建 $DEST" "Can't create $DEST")"
cp "$SRC/main.js" "$SRC/preload.js" "$SRC/package.json" "$SRC"/*.png "$SRC/uninstall.sh" "$DEST/" || fail "$(t '复制失败' 'Copy failed')"
ok "$DEST"

echo ""
echo "$(t '[2/3] 下载运行环境（Electron，约 100 MB，只需一次）' '[2/3] Downloading the runtime (Electron, ~100 MB, one time)')"
( cd "$DEST" && "$NPM" install --omit=dev --no-audit --no-fund --loglevel=error ) || fail "$(t '下载失败。检查网络后再运行一次本脚本' 'Download failed. Check your connection and run this again')"
ELECTRON="$(cd "$DEST" && "$NODE" -e "console.log(require('electron'))")"
[ -n "$ELECTRON" ] && [ -e "$ELECTRON" ] || fail "$(t '没找到 Electron 程序' 'Electron executable not found')"
ok "Electron"

echo ""
echo "$(t '[3/3] 登录后自动打开，并现在启动' '[3/3] Open at login, and start it now')"
case "$(uname -s)" in
Darwin)
  mkdir -p "$HOME/Library/LaunchAgents"
  la_stop "$LABEL"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$ELECTRON</string><string>$DEST</string></array>
  <key>EnvironmentVariables</key><dict><key>CAT_LANG</key><string>$L</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$VIZ/widget.log</string>
  <key>StandardErrorPath</key><string>$VIZ/widget.log</string>
</dict>
</plist>
PL
  # 「Agent 卡片」小程序：放在 ~/Applications 里，聚焦搜索（⌘ 空格）输入 Agent 就能把卡片叫出来
  # a tiny "Agent Card" app in ~/Applications: Spotlight (⌘ Space) → "Agent" brings the card back
  APPDIR="$HOME/Applications"; mkdir -p "$APPDIR"
  for n in "Agent 卡片" "Agent Card"; do rm -rf "$APPDIR/$n.app"; done
  APPNAME="$(t 'Agent 卡片' 'Agent Card')"
  if osacompile -o "$APPDIR/$APPNAME.app" -e "do shell script quoted form of \"$ELECTRON\" & \" \" & quoted form of \"$DEST\" & \" > /dev/null 2>&1 &\"" >/dev/null 2>&1; then
    # 用看板的图标 / use the board's icon
    ICON_SRC="$SRC/../public/icon-512.png"
    if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1; then
      SET="$(mktemp -d)/agent.iconset"; mkdir -p "$SET"
      for s in 16 32 128 256 512; do
        sips -z $s $s "$ICON_SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null 2>&1
        sips -z $((s*2)) $((s*2)) "$ICON_SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null 2>&1
      done
      iconutil -c icns "$SET" -o "$APPDIR/$APPNAME.app/Contents/Resources/applet.icns" >/dev/null 2>&1
    fi
    touch "$APPDIR/$APPNAME.app"
    ok "$(t "关掉卡片后，⌘ 空格搜「Agent」就能再打开（$APPDIR/$APPNAME.app）" "After closing the card, ⌘ Space → \"Agent\" opens it again ($APPDIR/$APPNAME.app)")"
  fi
  if la_start "$LABEL" "$PLIST"; then ok "$(t '卡片已经出现在屏幕右上角；菜单栏里有它的图标，可以隐藏、置顶、退出' 'The card is at the top right of your screen; its menu-bar icon lets you hide it, pin it or quit')"
  else warn "$(t "没能自动启动，可以手动运行：\"$ELECTRON\" \"$DEST\"" "Couldn't start it automatically; run: \"$ELECTRON\" \"$DEST\"")"; fi
  ;;
MINGW*|MSYS*|CYGWIN*)
  STARTUP="$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup"
  [ -d "$STARTUP" ] || STARTUP="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/Startup"
  VBS="$STARTUP/claude-agent-card.vbs"
  WEL="$(cygpath -w "$ELECTRON")"; WDEST="$(cygpath -w "$DEST")"
  [ -f "$VIZ/widget.pid" ] && taskkill //F //PID "$(cat "$VIZ/widget.pid")" >/dev/null 2>&1
  mkdir -p "$STARTUP"
  cat > "$VBS" <<VB
' Agent Card: start hidden at Windows login
Set sh = CreateObject("WScript.Shell")
sh.Environment("PROCESS")("CAT_LANG") = "$L"
sh.Run """$WEL"" ""$WDEST""", 0, False
VB
  wscript.exe "$(cygpath -w "$VBS")" >/dev/null 2>&1 &
  ok "$(t '卡片已经出现在屏幕右上角；右下角托盘里有它的图标，可以隐藏、置顶、退出' 'The card is at the top right of your screen; its tray icon lets you hide it, pin it or quit')"
  ;;
*)
  warn "$(t "这个系统请手动运行：\"$ELECTRON\" \"$DEST\"" "On this system, run: \"$ELECTRON\" \"$DEST\"")"
  ;;
esac
echo ""
echo "$(t '  卸载：' '  Uninstall: ')bash \"$DEST/uninstall.sh\""
echo ""

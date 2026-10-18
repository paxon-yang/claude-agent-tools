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
echo "$(t '[3/3] 放一个「Agent 卡片」程序：点它才打开，不再开机自动弹出' '[3/3] Adding an "Agent Card" app: it opens only when you click it, not at login')"
# 默认不随登录启动（省内存）。卡片菜单里勾了「登录时自动打开」会留下这个标记，更新时照旧保留
# not started at login by default (saves memory). Ticking "Open at login" in the card's menu leaves this marker; updates keep it
MARK="$VIZ/widget.autostart"
# 更新前卡片开着，更新后就重新打开；本来关着就保持关着
# if the card was open before the update, reopen it afterwards; if it was closed, leave it closed
WAS_RUNNING=0
if [ -f "$VIZ/widget.pid" ] && kill -0 "$(cat "$VIZ/widget.pid" 2>/dev/null)" 2>/dev/null; then WAS_RUNNING=1; fi
FIRST=0; [ -f "$VIZ/widget.installed" ] || FIRST=1
case "$(uname -s)" in
Darwin)
  mkdir -p "$HOME/Library/LaunchAgents"
  la_stop "$LABEL"
  # 等旧卡片真正退出，不然新开的会撞上「只能开一个」的锁 / wait for the old card to exit, or the new one hits the single-instance lock
  if [ -f "$VIZ/widget.pid" ]; then OLD="$(cat "$VIZ/widget.pid")"; kill "$OLD" >/dev/null 2>&1
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$OLD" 2>/dev/null || break; sleep 0.5; done; fi
  if [ -f "$MARK" ]; then
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
    ok "$(t '登录时自动打开：开（你在卡片菜单里勾选过）' 'Open at login: on (you ticked it in the card menu)')"
  else
    rm -f "$PLIST"
    ok "$(t '登录时不再自动打开（想要的话，卡片的菜单栏图标里勾「登录时自动打开」）' 'Not opened at login (tick "Open at login" in its menu-bar icon if you want that)')"
  fi
  # 「Agent 卡片」小程序：这就是开关。点它打开卡片；卡片上的 ✕ 关掉程序、释放内存
  # the "Agent Card" app is the switch: click it to open the card; the ✕ on the card quits and frees the memory
  APPDIR="$HOME/Applications"; mkdir -p "$APPDIR"
  for n in "Agent 卡片" "Agent Card"; do rm -rf "$APPDIR/$n.app"; done
  APPNAME="$(t 'Agent 卡片' 'Agent Card')"
  if osacompile -o "$APPDIR/$APPNAME.app" -e "do shell script \"CAT_LANG=$L \" & quoted form of \"$ELECTRON\" & \" \" & quoted form of \"$DEST\" & \" >> \" & quoted form of \"$VIZ/widget.log\" & \" 2>&1 &\"" >/dev/null 2>&1; then
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
    ok "$(t "开关：$APPDIR/$APPNAME.app —— ⌘ 空格搜「Agent」打开，或把它拖到程序坞" "Switch: $APPDIR/$APPNAME.app — ⌘ Space → \"Agent\", or drag it to the Dock")"
    if [ "$WAS_RUNNING" = 1 ] || [ "$FIRST" = 1 ]; then
      open "$APPDIR/$APPNAME.app" >/dev/null 2>&1 && ok "$(t '卡片已打开；点 ✕ 就整个关掉' 'The card is open; click ✕ to close it completely')"
    fi
  else
    warn "$(t "没能生成「Agent 卡片」程序，可以手动运行：\"$ELECTRON\" \"$DEST\"" "Couldn't create the app; run: \"$ELECTRON\" \"$DEST\"")"
  fi
  ;;
MINGW*|MSYS*|CYGWIN*)
  PROGS="$APPDATA/Microsoft/Windows/Start Menu/Programs"
  [ -d "$PROGS" ] || PROGS="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs"
  STARTUP="$PROGS/Startup"
  WEL="$(cygpath -w "$ELECTRON")"; WDEST="$(cygpath -w "$DEST")"
  [ -f "$VIZ/widget.pid" ] && taskkill //F //PID "$(cat "$VIZ/widget.pid")" >/dev/null 2>&1
  # 打开卡片的小脚本 + 开始菜单里的「Agent Card」快捷方式 / a launcher script plus an "Agent Card" Start Menu shortcut
  LAUNCH="$DEST/agent-card.vbs"
  cat > "$LAUNCH" <<VB
' Agent Card: open the card
Set sh = CreateObject("WScript.Shell")
sh.Environment("PROCESS")("CAT_LANG") = "$L"
sh.Run """$WEL"" ""$WDEST""", 0, False
VB
  WLAUNCH="$(cygpath -w "$LAUNCH")"; WLNK="$(cygpath -w "$PROGS")\\Agent Card.lnk"
  powershell.exe -NoProfile -Command "\$s=(New-Object -ComObject WScript.Shell).CreateShortcut('$WLNK'); \$s.TargetPath='wscript.exe'; \$s.Arguments='\"$WLAUNCH\"'; \$s.IconLocation='$WEL,0'; \$s.Save()" >/dev/null 2>&1 \
    && ok "$(t '开关：开始菜单里搜「Agent Card」打开卡片' 'Switch: search "Agent Card" in the Start menu to open the card')"
  if [ -f "$MARK" ]; then mkdir -p "$STARTUP"; cp "$LAUNCH" "$STARTUP/claude-agent-card.vbs"
    ok "$(t '登录时自动打开：开（你在卡片菜单里勾选过）' 'Open at login: on (you ticked it in the card menu)')"
  else rm -f "$STARTUP/claude-agent-card.vbs"
    ok "$(t '登录时不再自动打开（想要的话，托盘图标里勾「登录时自动打开」）' 'Not opened at login (tick "Open at login" in its tray icon if you want that)')"
  fi
  if [ "$WAS_RUNNING" = 1 ] || [ "$FIRST" = 1 ]; then wscript.exe "$WLAUNCH" >/dev/null 2>&1 & fi
  ;;
*)
  warn "$(t "这个系统请手动运行：\"$ELECTRON\" \"$DEST\"" "On this system, run: \"$ELECTRON\" \"$DEST\"")"
  ;;
esac
date > "$VIZ/widget.installed"
echo ""
echo "$(t '  卸载：' '  Uninstall: ')bash \"$DEST/uninstall.sh\""
echo ""

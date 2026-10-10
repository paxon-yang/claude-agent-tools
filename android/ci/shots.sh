#!/usr/bin/env bash
# 在模拟器里装上调试版、连到演示看板、把卡片加到桌面、截图（GitHub Actions 里跑）
# On the emulator: install the debug build, point it at the demo board, pin the card, take screenshots (run by GitHub Actions)
set -x
PKG=io.github.paxonyang.agentcard
APK="$1"
shot() { adb exec-out screencap -p > "out/$1.png"; }
# 按文字找到界面上的按钮并点它 / tap the on-screen element whose text matches
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml out/ui.xml >/dev/null 2>&1
  xy=$(python3 - "$1" <<'PY'
import re, sys
xml = open('out/ui.xml', encoding='utf-8').read()
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    t = re.search(r' text="([^"]*)"', n); d = re.search(r'content-desc="([^"]*)"', n)
    label = ((t.group(1) if t else '') + ' ' + (d.group(1) if d else '')).strip()
    if re.search(sys.argv[1], label, re.I):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b:
            x1, y1, x2, y2 = map(int, b.groups()); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
  [ -n "$xy" ] && adb shell input tap $xy
}
# 等某个文字出现在屏幕上（最多 $2 秒）/ wait until some text is on screen (up to $2 seconds)
wait_text() {
  for _ in $(seq 1 "${2:-20}"); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    adb pull /sdcard/ui.xml out/ui.xml >/dev/null 2>&1
    grep -qE "$1" out/ui.xml && return 0
    sleep 1
  done
  return 1
}
mkdir -p out
adb install -r "$APK"
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb shell cmd locale set-app-locales $PKG --locales zh-CN
# 和手机扫码一样：配对页上的链接打开 App，确认后连接 / same as scanning the QR code: the pairing link opens the app
adb shell am start -a android.intent.action.VIEW -d "agentcard://pair?url=http%3A%2F%2F10.0.2.2%3A4330\&key=$CARD_KEY\&board=http%3A%2F%2F10.0.2.2%3A4330"
wait_text 'text="(连接|Connect)"' 30
shot pair-confirm
tap_text '^(连接|Connect)$'
sleep 10
shot app-zh
adb shell am start -S -n $PKG/.MainActivity --ez pin true
sleep 5
shot pin-dialog
sleep 4
shot pin-dialog-2
tap_text '^(Add to home screen|Add automatically|Add|添加)\s*$'
sleep 4
adb shell input keyevent KEYCODE_HOME
sleep 6
shot home-zh
# 点卡片进入实时模式 / tap the card for live mode
tap_text 'Agent|monthly|compliance|camic'
sleep 25
shot home-zh-live
adb shell cmd statusbar expand-notifications
sleep 3
shot notification
adb shell cmd statusbar collapse
sleep 30
shot home-zh-live-2
# 样例数据：一个正在跑、带子代理和后台任务的会话 / sample: a busy session with sub-agents and a background task
NOW=$(date +%s)
SAMPLE=$(cat <<JSON | base64 -w0
{"v":1,"now":$NOW,"lang":"zh","demo":true,
 "session":{"id":"s","project":"monthly-report-app","status":"running","active":true,"task":"给月报页面加 PDF 导出，并补上测试","taskStartedAt":$((NOW-434)),"taskEndedAt":null,
  "model":"Opus 5.5","family":"opus","effort":"high","agentsRunning":2,"bgRunning":1,"now":"Agent → worker","needMsg":null,"reason":"多步骤大任务","cacheUntil":$((NOW+2460)),"gate":"pass","lastEventAt":$NOW,
  "running":[{"kind":"agent","name":"explorer","model":"Haiku 5.5","family":"haiku","text":"Grep · ExportButton"},{"kind":"agent","name":"worker","model":"Sonnet 5.5","family":"sonnet","text":"Edit · pdf-export.ts"},{"kind":"bg","name":"Bash","model":null,"family":null,"text":"npm run dev"}]},
 "others":[{"project":"compliance-docs","status":"needs-you"},{"project":"camic-site","status":"idle"}],"needsYou":1,
 "limits":{"at":$NOW,"sevenDay":{"pct":37,"resetsAt":"$(date -u -d '+3 days 14 hours' +%Y-%m-%dT%H:%M:%SZ)"},"fiveHour":{"pct":18,"resetsAt":null}},
 "totals":{"cost":2.1,"baseline":5.99,"saved":0.65,"hours":24,"baselineModel":"opus"}}
JSON
)
adb shell am force-stop $PKG
adb shell am start -n $PKG/.MainActivity --es sample "$SAMPLE"
sleep 6
shot app-sample
adb shell input keyevent KEYCODE_BACK
sleep 4
shot home-sample
adb shell cmd locale set-app-locales $PKG --locales en-US
adb shell am force-stop $PKG
adb shell am start -n $PKG/.MainActivity
sleep 8
shot app-en
adb logcat -d | grep -iE 'agentcard|AndroidRuntime|FATAL EXCEPTION' | tail -200 > out/logcat.txt || true
ls -la out

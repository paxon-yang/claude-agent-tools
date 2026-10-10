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
    label = (t.group(1) if t else '') + ' ' + (d.group(1) if d else '')
    if re.search(sys.argv[1], label, re.I):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b:
            x1, y1, x2, y2 = map(int, b.groups()); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
  [ -n "$xy" ] && adb shell input tap $xy
}
mkdir -p out
adb install -r "$APK"
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb shell cmd locale set-app-locales $PKG --locales zh-CN
adb shell am start -n $PKG/.MainActivity --es url http://10.0.2.2:4330
sleep 12
shot app-zh
adb shell am start -n $PKG/.MainActivity --ez pin true
sleep 5
shot pin-dialog
tap_text '^(Add to home screen|Add automatically|Add|添加)\s*$'
sleep 4
adb shell input keyevent KEYCODE_HOME
sleep 6
shot home-zh
# 点卡片进入实时模式 / tap the card for live mode
tap_text 'Agent|monthly|compliance|camic'
sleep 25
adb shell input keyevent KEYCODE_HOME
sleep 2
shot home-zh-live
adb shell cmd statusbar expand-notifications
sleep 3
shot notification
adb shell cmd statusbar collapse
adb shell cmd locale set-app-locales $PKG --locales en-US
adb shell am force-stop $PKG
adb shell am start -n $PKG/.MainActivity
sleep 8
shot app-en
adb shell input keyevent KEYCODE_HOME
sleep 5
shot home-en
adb logcat -d | grep -iE 'agentcard|AndroidRuntime|FATAL EXCEPTION' | tail -200 > out/logcat.txt || true
ls -la out

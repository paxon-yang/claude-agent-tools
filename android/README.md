# Agent Card for Android · 安卓桌面卡片

A home-screen widget that shows your Claude Code agent board at a glance: the current task, model and effort, running sub-agents, cache time left, the test gate, and the last 24 hours' cost and savings.

把 Agent 看板放到安卓手机桌面上：当前任务、模型和 effort、在跑的子代理、缓存还剩多久、测试关卡、近 24 小时花了多少、省了多少。

![Agent Card](https://raw.githubusercontent.com/paxon-yang/claude-agent-tools/android-preview/home-zh-live.png)

## 安装（中文）

**最简单：电脑上一条命令，手机扫一下。** 前提：看板已经用 `cloudflare.sh` 挂到你的域名上。

1. 在 Mac 终端运行：
   ```bash
   bash ~/claude-agent-tools/agent-viz/phone.sh
   ```
   它会在同一条隧道上加一个只给卡片用的网址（默认 `agent-card.你的域名`），生成一串配对码，然后在终端里显示一个二维码。
2. 用手机相机扫这个二维码，打开的页面上按三步做：**下载安装 App → 打开 App 并连接 → 添加到桌面**。
3. ColorOS 会清理后台：设置 → 应用 → Agent 卡片，打开**自启动**和**允许后台运行**（或在电池里设为"不限制"），否则卡片会停更。

以后要再显示二维码：`phone.sh --qr`；换一个配对码（旧手机要重扫）：`phone.sh --new-key`；停用：`phone.sh --remove`。

**这样安全吗？** 卡片专用网址不经过 Cloudflare 的邮箱登录，但它只回答两样东西：卡片数据（一个会话的摘要和花费合计）和配对页，而且都必须带配对码（32 位随机字符，猜不到）。完整看板还在原来的网址上，照样要邮箱登录。配对码泄露了就运行 `phone.sh --new-key` 换掉。

**其他连法：**
- 手机装了 **Tailscale**：App 里直接填电脑的 Tailscale 地址，比如 `http://100.x.y.z:4321`，配对码留空。
- 想让卡片也走 Cloudflare 的登录：用服务令牌（见下面），填看板网址和令牌。

**怎么刷新：** 每 15 分钟自动刷新一次（安卓对桌面小组件的最短间隔）。**点一下卡片**进入实时模式：有会话在跑时每 15 秒刷新，通知栏有一条"实时更新"（可以点"停止"），闲下来 10 分钟后自动停。卡片右下角的 ↗ 打开完整看板。

APK 也可以单独下载：https://github.com/paxon-yang/claude-agent-tools/releases/download/card-android/agent-card.apk

### Cloudflare 服务令牌（可选）

1. Cloudflare Zero Trust → **Access → Service Auth → Create Service Token**，复制 **Client ID** 和 **Client Secret**（Secret 只显示一次）。
2. Access → Applications → 看板的那个应用 → **Policies → Add a policy**：Action 选 **Service Auth**，Include 选 **Service Token** = 刚才的令牌，保存。
3. 在 App 里填看板网址 `https://board.你的域名` 和这两串值。

## Install (English)

**Easiest: one command on the computer, one scan on the phone.** Needs the board on your domain via `cloudflare.sh`.

1. On the Mac:
   ```bash
   bash ~/claude-agent-tools/agent-viz/phone.sh
   ```
   It adds a card-only address to the same tunnel (default `agent-card.<your domain>`), creates a pairing key and shows a QR code in the terminal.
2. Scan it with the phone camera and follow the page: **install the app → open the app and connect → add it to the home screen**.
3. On ColorOS, MIUI and similar, allow auto-launch / background activity for the app, or the system pauses it.

Show the QR code again: `phone.sh --qr`; new key (phones must rescan): `phone.sh --new-key`; turn it off: `phone.sh --remove`.

**Is it safe?** The card-only address skips Cloudflare's email login, but it answers just two things — the card data (one session summary and cost totals) and the pairing page — and only with the 32-character random key. The full board stays on its own address behind the login. If the key leaks, run `phone.sh --new-key`.

**Other ways to connect:**
- **Tailscale** on the phone: enter the computer's Tailscale address, e.g. `http://100.x.y.z:4321`, and leave the key empty.
- Keep the card behind Cloudflare's login: use a service token (below) with the board's address.

**Refresh:** every 15 minutes (the shortest Android allows for widgets). **Tap the card** for live mode: every 15 seconds while a session is busy, with an ongoing "Live updates" notification you can stop; it ends by itself after 10 quiet minutes. The ↗ opens the full board.

APK on its own: https://github.com/paxon-yang/claude-agent-tools/releases/download/card-android/agent-card.apk

### Cloudflare service token (optional)

1. Cloudflare Zero Trust → **Access → Service Auth → Create Service Token**; copy the **Client ID** and **Client Secret**.
2. In the board's Access application, add a policy: Action **Service Auth**, Include **Service Token** = that token.
3. Enter the board address and both values in the app.

## Privacy

The app talks only to the address you enter or pair with; it reads `/api/widget` (one session summary and the totals). Nothing else leaves the phone. A pairing link always asks before it changes the address.

## Build it yourself

```bash
cd android
gradle assembleRelease      # Gradle 8.14, JDK 17, Android SDK 35
```

Releases on GitHub are signed with `app/public-release.jks` (password `agentcard`), which is public so anyone can rebuild the same app. To sign with your own key, set the repository secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`; note that switching keys means uninstalling the old app once.

# Agent Card for Android · 安卓桌面卡片

A home-screen widget that shows your Claude Code agent board at a glance: the current task, model and effort, running sub-agents, cache time left, the test gate, and the last 24 hours' cost and savings.

把 Agent 看板放到安卓手机桌面上：当前任务、模型和 effort、在跑的子代理、缓存还剩多久、测试关卡、近 24 小时花了多少、省了多少。

![Agent Card](https://raw.githubusercontent.com/paxon-yang/claude-agent-tools/android-preview/shot-zh-2.png)

## 安装（中文）

1. 手机浏览器打开 **https://github.com/paxon-yang/claude-agent-tools/releases/download/card-android/agent-card.apk** 下载，点开安装。系统提示"未知来源"时选择允许（ColorOS：设置 → 安全 → 允许安装未知应用）。
2. 打开 **Agent 卡片**，填看板地址，点"保存并测试"：
   - 手机装了 **Tailscale**：填电脑的 Tailscale 地址，比如 `http://100.x.y.z:4321`（看板左下角能看到）。
   - 用 **Cloudflare** 的域名：填 `https://board.你的域名`，再填服务令牌（见下面）。
3. 点"把卡片添加到桌面"，或者长按桌面 → 插件 → Agent 卡片。
4. ColorOS 会清理后台：设置 → 应用 → Agent 卡片，打开**自启动**和**允许后台运行**（或在电池里设为"不限制"），否则卡片会停更。

**怎么刷新：** 每 15 分钟自动刷新一次（安卓对桌面小组件的最短间隔）。**点一下卡片**进入实时模式：有会话在跑时每 15 秒刷新，通知栏有一条"实时更新"（可以点"停止"），闲下来 10 分钟后自动停。卡片右下角的 ↗ 打开完整看板。

### Cloudflare 服务令牌

看板挂在 Cloudflare Access 后面时，浏览器靠邮箱登录，小组件不行，要用服务令牌：

1. Cloudflare Zero Trust → **Access → Service Auth → Create Service Token**，起个名字（比如 `agent-card`），复制 **Client ID** 和 **Client Secret**（Secret 只显示一次）。
2. Access → Applications → 看板的那个应用 → **Policies → Add a policy**：Action 选 **Service Auth**，Include 选 **Service Token** = 刚才的令牌，保存。
3. 把 Client ID 和 Client Secret 填进 App。

## Install (English)

1. On the phone, download **https://github.com/paxon-yang/claude-agent-tools/releases/download/card-android/agent-card.apk** and open it. Allow installing from this source when asked.
2. Open **Agent Card**, enter the board address and tap **Save and test**:
   - **Tailscale** on the phone: the computer's Tailscale address, e.g. `http://100.x.y.z:4321` (shown in the board's sidebar).
   - **Cloudflare** domain: `https://board.example.com`, plus a service token (below).
3. Tap **Add the card to the home screen**, or long-press the home screen → Widgets → Agent Card.
4. On ColorOS, MIUI and similar, allow auto-launch / background activity for the app, or the system pauses it.

**Refresh:** every 15 minutes (the shortest Android allows for widgets). **Tap the card** for live mode: every 15 seconds while a session is busy, with an ongoing "Live updates" notification you can stop; it ends by itself after 10 quiet minutes. The ↗ opens the full board.

### Cloudflare service token

1. Cloudflare Zero Trust → **Access → Service Auth → Create Service Token**; copy the **Client ID** and **Client Secret**.
2. In the board's Access application, add a policy: Action **Service Auth**, Include **Service Token** = that token.
3. Enter both in the app.

## Privacy

The app talks only to the board address you enter; it reads `/api/widget` (one session summary and the totals). Nothing else leaves the phone.

## Build it yourself

```bash
cd android
gradle assembleRelease      # Gradle 8.14, JDK 17, Android SDK 35
```

Releases on GitHub are signed with `app/public-release.jks` (password `agentcard`), which is public so anyone can rebuild the same app. To sign with your own key, set the repository secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`; note that switching keys means uninstalling the old app once.

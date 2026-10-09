# Claude Code 自动选模型 + 代理看板

两个配套的小工具，装一次，对所有项目生效。

- **auto-router**：Claude Code 每一轮自动选模型和 effort。简单提问交给 Haiku，日常开发交给 Sonnet，架构、重构和大任务交给 Opus 统筹并派子代理分工，Fable 当顾问。
- **agent-viz**：看板（http://localhost:4321），实时显示所有项目的状态、当前任务、主会话和子代理的分工、模型时间轴、估算花费（以及比全用 Opus 少花多少）、任务记录；Claude 等你确认时会提醒你。装了 [Tailscale](https://tailscale.com/download) 的话，你的其他电脑和手机也能打开。

## 安装（Mac）

打开"终端"，粘贴这一行，按回车：

```bash
git clone https://github.com/paxon-yang/claude-agent-tools.git ~/claude-agent-tools && bash ~/claude-agent-tools/install.sh
```

装完关掉所有 Claude Code，重新打开。

## 更新

```bash
bash ~/claude-agent-tools/update.sh
```

也可以直接在 Claude Code 里说一句："运行 bash ~/claude-agent-tools/update.sh"，让它替你更新。更新完重开 Claude Code 生效。

## 在其他电脑和手机上看看板

在 Mac 和其他设备上都装 Tailscale 并登录同一个账号，看板左下角会显示远程地址（比如 `http://你的Mac名.xxx.ts.net:4321`），在其他设备的浏览器里打开即可。只有你自己的设备能访问。不想开放：把 `~/.claude/viz/app/config.json` 里的 `remote` 改成 `off`。

## 日常用法

- `/route` 查看当前模型和最近的选择；`/route rules` 查看规则
- `/route opus` 固定某个模型；`/route auto` 恢复自动；`/route off` 关闭
- 提示里写 `#haiku` / `#sonnet` / `#opus` / `#fable`，只对这一句生效
- 大任务：Shift+Tab 进计划模式，Opus 出方案，回"执行"后换 Sonnet 动手

## 卸载

```bash
bash ~/.claude/auto-router/uninstall.sh
bash ~/.claude/viz/app/uninstall.sh
```

设置在 `~/.claude/auto-router/config.json`，各项含义见 auto-router/说明.txt。

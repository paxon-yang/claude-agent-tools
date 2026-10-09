# Claude Code 自动选模型 + 代理看板

两个配套的小工具，装一次，对所有项目生效。

- **auto-router**：Claude Code 每一轮自动选模型和 effort。简单提问交给 Haiku，日常开发交给 Sonnet，架构、重构和大任务交给 Opus 统筹并派子代理分工，Fable 当顾问。
- **agent-viz**：本地看板（http://localhost:4321），实时显示当前任务、主会话和子代理的树形结构、每个节点用的模型、effort、上下文和自动选模型的理由。

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

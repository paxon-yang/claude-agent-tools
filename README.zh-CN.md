<div align="center">

# Claude Agent Tools

**给 Claude Code 自动选模型 + 实时代理看板。**<br>
简单问题交给 Haiku，日常开发交给 Sonnet，大任务由 Opus 统筹派活——
每个代理用的什么模型、花了多少钱，实时看得见。

**[▶ 在线看演示](https://paxon-yang.github.io/claude-agent-tools/)** · [English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/paxon-yang/claude-agent-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/paxon-yang/claude-agent-tools/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/paxon-yang/claude-agent-tools?color=1d1d1f)](https://github.com/paxon-yang/claude-agent-tools/releases)

<img src="docs/demo.gif" alt="实时代理看板：Opus 统筹，Haiku 和 Sonnet 子代理在跑" width="100%">

<sub>演示数据。<a href="https://paxon-yang.github.io/claude-agent-tools/">打开在线演示</a> · <a href="docs/demo.mp4">高清视频</a></sub>

</div>

## 为什么做这个

Claude Code 默认一个模型干到底，想换就得自己敲 `/model`。结果要么用 Opus 的价格问"登录代码在哪"，要么让 Sonnet 去设计整个迁移方案。会话派出一堆子代理以后，谁在干什么也看不见。

这个仓库有两个小工具：

| | 做什么 |
|---|---|
| **auto-router** | Claude Code 插件。**每一轮**、每个子代理都自动选模型和 effort：提问查找给 Haiku，日常开发给 Sonnet，架构和多步骤大任务给 Opus（负责计划和派活）。自带的报告会用你自己电脑上的真实记录，算出比全程用 Opus 少花了多少。 |
| **agent-viz** | 本地看板 `http://localhost:4321`：所有项目、当前任务、主会话和子代理的实时分工图、每个节点用的模型、模型时间轴、估算花费和省了多少；Claude 等你批准时会提醒你。手机上也能看。 |

## 和其他工具的区别

| | **claude-agent-tools** | [claude-code-router](https://github.com/musistudio/claude-code-router) | [ccusage](https://github.com/ryoppippi/ccusage) | 手动 `/model` |
|---|---|---|---|---|
| 是什么 | 插件 + 本地看板 | 架在 Claude Code 前面的代理 | 用量分析命令行 | 自带 |
| 怎么选模型 | **每一轮、每个子代理**自动选 | 按场景（后台、思考、长上下文……）转发，可接任意厂商 | — | 你记得时自己换 |
| 只用 Anthropic 模型、不经代理 | ✓ | 经过它的代理 | ✓ | ✓ |
| 实时看到子代理 | ✓ | — | — | — |
| 看花费 | 实时 + 对比全用 Opus 的报告 | — | ✓ 详细的用量和费用报告 | — |

喜欢 ccusage 的报表可以一起用；想接非 Anthropic 的模型用 claude-code-router。这个项目适合想继续用 Claude、又不想在简单问题上多花钱的人。

## 功能

- **每轮自动选模型**：先按规则判断，拿不准再让 Haiku 判断。提示里写 `#opus` `#sonnet` `#haiku` `#fable` 只对这一句生效；`/route opus` 固定模型。
- **多模型协作**：大任务（比如"按照 docs/spec.md 修改"）由 Opus 统筹，`explorer` 子代理用 Haiku 读代码，`worker` 子代理用 Sonnet 写代码。
- **先计划后执行**：计划模式（Shift+Tab）里 Opus 出方案，批准后换 Sonnet 动手。
- **保护**：Haiku 要改第 4 个文件、或要跑 `rm -rf`、`git push`、迁移、部署这类命令时，先换 Sonnet 接手；一轮里失败 3 次当场升一档；降档要连续两轮确认。
- **省钱**：子代理交回的结果用 Sonnet 汇总，不让 Opus 反复重读大上下文；长对话不会被锁死在 Opus。
- **实时分工图**：子代理在跑时连线上有光点流动，交回结果时一颗绿点流回主会话；悬停高亮这条线；点任意卡片看它领到的活、交回的结果和每一步工具调用。
- **模型时间轴和花费**：每一轮、每个子代理用的模型，按模型统计 token、估算费用和**省了多少**。
- **等你确认提醒**：会话卡在等你批准时，顶部横幅、桌面通知或提示音。
- **随处访问**：Tailscale（私有，零配置），或用 Cloudflare 隧道挂到自己的域名 + 邮箱验证码登录。
- **省钱报告**：`node ~/.claude/viz/app/report.js` 读你本机的会话记录，算出每个模型花了多少、全用 Opus 要多少、自动选模型接管的会话和其他会话各省多少；加 `--md` 生成可以分享的报告。
- **中文和英文**：选模型的提示、看板（左下角 EN | 中文 一键切换）、安装脚本都跟随系统语言。
- **苹果风格液态玻璃界面**，浅色，适配手机，尊重"减少动态效果"设置。

<table>
<tr>
<td width="62%"><img src="docs/flow.png" alt="分工图"></td>
<td><img src="docs/mobile.png" alt="手机"></td>
</tr>
<tr>
<td colspan="2"><img src="docs/details.png" alt="详情抽屉：每一步工具调用"></td>
</tr>
</table>

## 安装

**需要：** Claude Code 2.1.288 或更新、Node.js 18+、Git。

### macOS / Linux

打开"终端"，粘贴这一行：

```bash
git clone https://github.com/paxon-yang/claude-agent-tools.git ~/claude-agent-tools && bash ~/claude-agent-tools/install.sh
```

### Windows（测试版）

打开 **PowerShell**，粘贴这一行：

```powershell
irm https://raw.githubusercontent.com/paxon-yang/claude-agent-tools/main/install.ps1 | iex
```

它会把仓库下载到 `%USERPROFILE%\claude-agent-tools`，再用 Git Bash 跑同一个安装脚本（Windows 上的 Claude Code 本来就需要 Git Bash）。看板放在"启动"文件夹里，登录 Windows 后在后台自动运行。

装完**重开 Claude Code**，浏览器打开 <http://localhost:4321>。

### 更新

```bash
bash ~/claude-agent-tools/update.sh
```

或者直接跟 Claude Code 说："运行 bash ~/claude-agent-tools/update.sh"。你改过的 `config.json` 会保留。

## 选模型的逻辑

```mermaid
flowchart LR
  P[你的提示] --> M{写了 #标签 或 /route 固定?}
  M -- 是 --> T[用指定的模型]
  M -- 否 --> R{规则}
  R -- "计划模式 / 多步骤大任务 / 架构" --> O[Opus · 统筹]
  R -- "提问、查找、小改动" --> H[Haiku]
  R -- 拿不准 --> C[Haiku 判断] --> S[Sonnet / Haiku / Opus + effort]
  O -. 派活 .-> E[explorer · Haiku]
  O -. 派活 .-> W[worker · Sonnet]
  E & W -. 交回结果 .-> SUM[Sonnet 汇总]
```

每一轮选了什么、为什么，Claude Code 底部状态栏、`/route` 命令和看板上都能看到。

## 日常用法

| 你输入 | 效果 |
|---|---|
| `/route` | 当前模型和最近的选择 |
| `/route rules` | 当前规则 |
| `/route sonnet` · `/route auto` · `/route off` | 固定模型 · 恢复自动 · 关闭 |
| `#opus 重构登录模块` | 只这一句用 Opus |
| Shift+Tab，然后回"执行" | Opus 出方案，Sonnet 动手 |

## 到底省了多少？

```bash
node ~/.claude/viz/app/report.js                   # 近 7 天
node ~/.claude/viz/app/report.js --days 30 --md    # 生成 claude-savings-日期.md，方便分享
```

```
Claude Code · 自动选模型省了多少
近 7 天 · 3 个会话 · 模型回复 7 次

  模型      回复次数   输入  缓存读取   输出  估算花费  占比
  Haiku            3   19万     150万    8万     $0.10   <1%
  Sonnet           1   20万     200万   10万     $1.80   16%
  Opus             2   40万     300万   23万     $9.40   83%

  实际约                   $11.30
  全用 Opus 约             $16.96
  少花          33%（省下 $5.66）
```

<sub>上面是测试数据的示例输出。按 API 公开价估算；用订阅的话这是等值金额，不是你的账单。</sub>

## 设置

编辑 `~/.claude/auto-router/config.json`，然后重开 Claude Code。常用的几项：

| 设置 | 默认 | 意思 |
|---|---|---|
| `defaultTier` | `sonnet` | 都判断不了时用的模型 |
| `bigTaskTier` | `opus` | 多步骤大任务的统筹者，改成 `sonnet` 更省钱 |
| `handbackTier` | `sonnet` | 谁来汇总子代理交回的结果 |
| `subagents` | explorer→haiku，worker→sonnet … | 每种子代理用的模型 |
| `haikuGuard.maxFiles` | `3` | Haiku 最多改几个文件就换 Sonnet |
| `autoFable` | `false` | 最难的任务自动交给 Fable |
| `lang` | 跟随系统 | 提示语言：`zh` 或 `en` |

看板的设置在 `~/.claude/viz/app/config.json`（端口、估算用的价格、远程访问、`lang`）。安装前设 `CAT_LANG=zh` 或 `CAT_LANG=en` 可以指定安装提示的语言。

## 在其他设备上看

- **Tailscale（私有）**：电脑和其他设备都装 Tailscale、登录同一个账号，看板会自动在 Tailscale 地址上开放，左下角显示链接。
- **自己的域名（Cloudflare）**：先在 Cloudflare Zero Trust 给这个网址建一个 Access 应用（邮箱验证码），再运行
  `bash ~/claude-agent-tools/agent-viz/cloudflare.sh board.你的域名`。
  它只新建一条名为 `agent-board` 的隧道，不动你其他的 cloudflared 设置。

## 卸载

```bash
bash ~/.claude/auto-router/uninstall.sh
bash ~/.claude/viz/app/uninstall.sh
```

改 `~/.claude/settings.json` 和 `~/.claude/CLAUDE.md` 之前都会先备份。

## 常见问题

**换模型会丢上下文吗？** 不会。对话都在，只是新模型要不带缓存地重读一遍，十几次调用就能省回来。所以长对话里也允许降档。

**会把我的数据发出去吗？** 不会。选模型在 Claude Code 里完成；看板只读本机文件，只在本机（以及你的 Tailscale 地址或你自己配的隧道）上开放。

**花费准吗？** 按 API 公开价估算。用订阅的话只看相对多少。

## 路线图

- 看板上按天、按周的花费历史
- 选错模型时一键反馈，让规则自己学
- Linux 开机自启（systemd）

欢迎提 Issue 和 PR，见 [CONTRIBUTING](CONTRIBUTING.md) 和[更新日志](CHANGELOG.md)。

## 许可

[MIT](LICENSE)

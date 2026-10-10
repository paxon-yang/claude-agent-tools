# Changelog

All notable changes to this project. Versions follow [semver](https://semver.org/); dates are UTC.

## [0.3.0] — 2026-10-10

### Added
- **English everywhere, Chinese kept.** The router (status line, `/route`, reasons, guard messages), the dashboard, every installer and the savings report now speak English and Simplified Chinese. Language is detected from your system (`CAT_LANG=en|zh` overrides); the dashboard has an **EN | 中文** switch.
- **English routing rules.** Every keyword list now has English equivalents with whole-word matching (`ok` no longer matches "token", `review` no longer matches "preview").
- **Savings report** — `node ~/.claude/viz/app/report.js` reads your local transcripts and shows what you actually spent per model versus running everything on Opus. `--md` writes a shareable Markdown report, `--json` for scripts, `--days`/`--since` for the period.
- **Live demo** on GitHub Pages — the real dashboard replaying recorded demo data, no install needed.
- **CI** on Ubuntu, macOS and Windows: plugin validation, routing tests, report tests, a demo-server smoke test and a full install → uninstall in a throwaway home.
- English templates for the delegation rules (`CLAUDE.md` block) and the four sub-agents.

### Changed
- Dashboard data is now language-neutral: the server sends keys, the browser renders them, so one board serves both languages.
- The closed detail drawer is fully hidden (it could peek out on some mobile browsers).

### Fixed
- `cloudflare.sh` couldn't read the tunnel ID with cloudflared 2026.x (`deleted_at` is `0001-01-01…` for live tunnels).

### Upgrading
`bash ~/claude-agent-tools/update.sh` — your `config.json` edits are kept. Existing installs keep Chinese (`"lang": "zh"` is added); set `"lang": "en"` in `~/.claude/auto-router/config.json` to switch.

## [0.2.0] — 2026-10-09

### Added
- Per-turn **effort** selection alongside the model.
- **Plan mode** routing: Opus plans, Sonnet executes after you approve.
- **Big-task orchestration**: Opus main session delegates to Haiku explorers and Sonnet workers.
- **Hand-back detection**: sub-agent results are summarized on Sonnet instead of being treated as a new task.
- Guards: Haiku file-count and dangerous-command escalation, mid-turn escalation after repeated tool failures, two-turn downgrade confirmation, context-window check.
- **agent-viz** dashboard: delegation graph, model timeline, cost vs all-Opus, task history, event log, approval alerts, Tailscale and Cloudflare (Access-protected) remote viewing.
- Windows support (beta) via Git Bash and a PowerShell bootstrap.

## [0.1.0]

- First version of the per-turn model router.

[0.3.0]: https://github.com/paxon-yang/claude-agent-tools/releases/tag/v0.3.0

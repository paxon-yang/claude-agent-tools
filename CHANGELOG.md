# Changelog

All notable changes to this project. Versions follow [semver](https://semver.org/); dates are UTC.

## [Unreleased]

### Added
- **Android home-screen card** (`android/`): a widget with the current task, model and effort, running sub-agents, cache time left, test gate and 24-hour cost; refreshes every 15 minutes, and every 15 seconds in live mode (tap the card) while a session is busy. Works over Tailscale or behind Cloudflare Access with a service token. Built and signed by GitHub Actions; the latest APK is always at the `card-android` release.
- Dashboard: `/api/widget`, a small summary for the card.
- `agent-viz/phone.sh`: connects a phone without the Cloudflare Zero Trust dashboard — adds a card-only address to the existing tunnel, protected by a random pairing key, and shows a QR code; the phone opens a page to install the app and pair in one tap. The full board stays behind its login.

## [0.4.0] — 2026-10-10

### Added
- **Cache-aware routing.** The prompt cache only works for the model that wrote it, so switching makes the new model re-read the conversation at the cache-write price. While the current model's cache is warm, the router now downgrades only when the turn will earn that back, and says so with a dollar estimate. It learns whether your cache lasts 5 minutes or 1 hour from real cache hits. Sub-agent hand-backs follow the same rule. The status line shows how long the cache has left.
- **Test gate.** When Haiku or Sonnet changed code in a turn, the project's tests run before the turn ends (npm / pnpm / yarn / bun, pytest, cargo, go, `make test`, or your own command). If they fail, the rest of the turn steps up to Opus and Claude keeps fixing; a second failure is left to you. Skipped for docs-only edits, when the model already ran the tests, or with `{"qualityGate": false}` in the project's `.claude/auto-router.json`.
- **`/route` is a card** (Markdown), so it reads well in the terminal, the desktop app and the Claude mobile app via Remote Control: model and why, cache time left, test gate, running sub-agents and background tasks, session cost and savings (from the dashboard when it is running), recent decisions as a table.
- Dashboard: cache time left and the last test-gate result next to the model; test-gate results in the event log.
- Dashboard: **Add to Home Screen** — icons and a web app manifest; opens full-screen on the card, with a way back and forth to the full board.
- **Desktop card** (`agent-viz/widget`): a small always-on-top window for macOS and Windows with the current task, model, step, running sub-agents and background tasks, and approval alerts. Also at `http://localhost:4321/mini` in any browser.
- The board shows **background tasks** (Monitor, `run_in_background` commands) and counts background sub-agents as running instead of finished.
- "Last activity N s ago" next to the delegation title.

### Changed
- FAQ: corrected the claim that switching models always pays for itself within a dozen calls; with a warm cache it often does not.
- The mini card's approval hint mentions the Claude app as well as the terminal.
- The delegation view shows only the current turn plus anything still running; finished cards collapse to one line, running edges flow as dashed lines.
- Task titles are shortened to one clause; the full prompt is one click away.

### Fixed
- macOS: the board service could fail to register with launchd right after an update (now waits for the old job and retries).

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

[0.4.0]: https://github.com/paxon-yang/claude-agent-tools/compare/v0.3.0...main
[0.3.0]: https://github.com/paxon-yang/claude-agent-tools/releases/tag/v0.3.0

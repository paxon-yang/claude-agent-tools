# Contributing

Thanks for helping! A few notes:

- **Try the dashboard without Claude Code:** `node agent-viz/server.js --demo --port 4322`, then open http://localhost:4322.
- **Router rules** live in `auto-router/hooks/rules.ts` (pure functions, unit-tested). Run the tests with `claude plugin test auto-router` and validate with `claude plugin validate auto-router`.
- **Savings report tests:** `node --test agent-viz/test/report.test.js`.
- **Translations:** every user-facing string exists in English and Chinese — router messages in `auto-router/hooks/i18n.ts`, dashboard text in the `I18N` table in `agent-viz/public/index.html`, installer text via the `t '中文' 'English'` helper. Please add both when you add a string (machine translation is fine; a native speaker will polish it).
- **Live demo page:** after changing the dashboard, run `node scripts/build-pages.js` to refresh `docs/index.html` and the recorded demo.
- **CI** runs all of the above plus a full install → uninstall on Ubuntu, macOS and Windows.
- **Keep it local-first:** no telemetry, no outbound calls from the dashboard.
- **Bug reports:** include your OS, `claude --version`, the output of `/route`, and the last lines of `~/.claude/viz/server.log`.
- Windows changes: please say which shell you tested in (PowerShell + Git Bash).

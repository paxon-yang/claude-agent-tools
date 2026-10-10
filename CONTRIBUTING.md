# Contributing

Thanks for helping! A few notes:

- **Try the dashboard without Claude Code:** `node agent-viz/server.js --demo --port 4322`, then open http://localhost:4322.
- **Router rules** live in `auto-router/hooks/rules.ts` (pure functions, unit-tested). Run the tests with `claude plugin test auto-router` and validate with `claude plugin validate auto-router`.
- **Keep it local-first:** no telemetry, no outbound calls from the dashboard.
- **Bug reports:** include your OS, `claude --version`, the output of `/route`, and the last lines of `~/.claude/viz/server.log`.
- Windows changes: please say which shell you tested in (PowerShell + Git Bash).

<!-- auto-router:start (installed by auto-router; removed automatically on uninstall) -->
## Dividing up multi-step tasks
- For a task that takes several steps (changes driven by a doc or plan, a new feature, a refactor, etc.): understand the requirements first, write a short plan, then start.
- Reading code, finding files, tracing call paths → send explorer sub-agents, several in parallel if useful; the main session should not read lots of files itself.
- Looking up docs or how a library is used → send researcher.
- Each independent piece of the plan → send worker; small changes such as copy, config or renames → send quick-worker.
- When delegating, state clearly: the goal, the files involved, what must not be touched, the acceptance criteria, and what to hand back.
- The main session owns planning, delegating, summarizing, running tests and reviewing; check what sub-agents hand back instead of taking it as fact.
- Before a big plan, when the same error keeps coming back, and before declaring a long task done, consult the advisor (if enabled).
- Write important decisions and agreements into the project's CLAUDE.md or PROGRESS.md, not just the conversation, so they survive model switches, context compaction and new sessions.
- When the main session is orchestrating, delegate both reading and writing code where possible (sub-agents use cheaper models); only make tiny edits of a few lines in one or two places yourself. Pure questions and simple small tasks don't need sub-agents.
<!-- auto-router:end -->

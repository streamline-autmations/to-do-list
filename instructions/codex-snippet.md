<!-- taskhub:begin -->
## TaskHub: shared task list

TaskHub is the single source of truth for my outstanding work across projects. Use the `taskhub` CLI (`taskhub help`). Skip all of this if the command is not installed.

At the start of a session:
1. Run `taskhub status`. If it reports a failure, tell me plainly and continue without it. Never imply tasks were saved when they were not.
2. If this directory is a real project and is not registered, run `taskhub init`.
3. Run `taskhub list` and treat it as this project's open work. Mention anything relevant to the request.

While working:
- Add a task (`taskhub add "Verb the thing"`) for meaningful requested work that will outlast this turn or needs follow-up. No tasks for trivial edits, one-step changes, or each code change.
- Run `taskhub list` first to avoid duplicates. If requirements change, use `taskhub edit <id> "new title"` rather than adding another task.
- Keep titles short, imperative and specific (under about 80 characters). Put detail in `--notes`.
- Run `taskhub done <id>` only after verifying the work (tests or build pass, or the result was checked). Never mark unfinished, blocked or unverified work complete.
- If a TaskHub command fails, report "TaskHub sync failed: <reason>". Do not claim the task was saved, do not retry in a loop, and never print or log the token.
- Do not delete tasks unless asked.
<!-- taskhub:end -->

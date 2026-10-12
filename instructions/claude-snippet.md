<!-- taskhub:begin -->
## TaskHub: shared task list

TaskHub is the single source of truth for my outstanding work across projects. Use the `taskhub` CLI (`taskhub help`). Skip all of this if the command is not installed.

**At the start of a session**
1. Run `taskhub status`. If it reports a failure, tell me plainly and continue without it. Never imply tasks were saved when they were not.
2. If this folder is a real project and is not registered, run `taskhub init`.
3. Run `taskhub list` and treat it as this project's open work. Mention anything relevant to what I ask for.

**While working**
- Add a task (`taskhub add "Verb the thing"`) for meaningful work I request that will outlast this turn or needs follow-up. Do not add tasks for trivial edits, one-step changes, or each code change.
- Check `taskhub list` first so you do not duplicate. If requirements change, `taskhub edit <id> "new title"` instead of adding another task.
- Titles are short, imperative and specific (under about 80 characters). Put detail in `--notes`.
- Run `taskhub done <id>` only after you have verified the work (tests or build pass, or you checked the result). Never mark unfinished, blocked or unverified work complete.
- If a TaskHub command fails, say "TaskHub sync failed: <reason>". Do not claim the task was saved, do not retry in a loop, and never print or log the token.
- Do not delete tasks unless I ask.
<!-- taskhub:end -->

# Using TaskHub from ChatGPT Work

ChatGPT Work cannot run commands on your computer and does not read your `CLAUDE.md` or `AGENTS.md`, so it cannot use the `taskhub` CLI. It uses TaskHub the way you do: through the web app. I could not test any ChatGPT product from here, so the options below are written to work whatever Work can or cannot do. Pick the first one that matches what you see.

**Never paste `TASKHUB_API_TOKEN`, your web password, or your database URL into a ChatGPT conversation or project instructions.**

## Option A: Work operates the web app (if it can browse for you)

If Work can open a site in a browser session, sign in to TaskHub yourself in that session first, so the password never goes through the chat. Then give it this as project instructions (replace the URL):

> My tasks live in TaskHub at https://YOUR-TASKHUB-URL. It is a checklist: projects are in the left sidebar (a menu on mobile), "All projects" shows everything outstanding.
>
> - To read tasks, open the project and read the checklist. Completed tasks are crossed out.
> - To add a task, type it in the "Add a task" field and press Enter. Keep titles short, imperative and specific. Check the list first so you do not add a duplicate.
> - To change a task, click its title, edit it and press Enter. Notes go in the notes field.
> - Tick a task complete only if I have told you it is finished or you have verified it yourself. Never delete tasks or projects unless I explicitly ask.
> - After any change, tell me exactly what you changed, and re-read the list to confirm it saved. If a message appears saying a change could not be saved, tell me; do not claim it worked.

## Option B: Work drafts, you run the commands

Reliable even if Work cannot touch the site. Ask Work for a list in this shape and paste it into a terminal in the project folder:

```text
taskhub add "Finish product import" --notes "CSV is in Drive"
taskhub add "Fix invoice rounding on partial refunds"
taskhub done 3f2a9c1b
```

To give Work context, paste the output of `taskhub list --all-projects` into the chat. Duplicate adds are harmless: the API skips an identical open task.

## Option C: Work calls the API (only if your plan supports authenticated API calls)

If Work or a custom GPT can make HTTP requests with a secret stored in its own secure credential field, the endpoints in [API.md](API.md) are all it needs (`GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/:id/complete`, `POST /api/projects/ensure`). If you do this:

1. Create a **separate** token for it and set `TASKHUB_API_TOKEN` to `agents-token,chatgpt-token` in Vercel, then redeploy. Remove the ChatGPT one the moment you stop using it, without disturbing Claude or Codex.
2. Store the token in the tool's credential field, never in the instructions.
3. Reuse the behaviour rules from Option A.

Skip this option if you are unsure what the product exposes. Option A or B is enough.

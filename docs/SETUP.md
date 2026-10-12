# Setup

About 20 minutes. You need a Supabase account, a Vercel account and a GitHub account (for the Vercel import). TaskHub gets its **own** Supabase project and its own Vercel project; nothing here touches your client projects or their databases.

## 0. Prerequisites on your machine

- Node.js 20+ in WSL (already there). **Windows itself has no Node today**, and the CLI needs it to run from PowerShell:

  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

  Then close and reopen the terminal.

## 1. Supabase (the database)

1. supabase.com/dashboard -> **New project**. Name it `taskhub`, pick a region near you, and set a strong **database password**. Save it in your password manager. Make a *new* project; do not reuse a client one.
2. When it is ready, click **Connect** (top bar) -> **Transaction pooler**. Copy the URI, which looks like

   ```
   postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
   ```

   Replace `[YOUR-PASSWORD]` with the real password. If it contains characters like `@ : / ? # %`, URL-encode them (`@` -> `%40`).
   Use the **pooler** URI, not the "Direct connection" one: Vercel can only reach Supabase over IPv4, and only the pooler offers that.
3. Create the tables. Either:
   - put the URI in `.env.local` as `DATABASE_URL=...` and run `npm run migrate`, or
   - open **SQL Editor**, paste all of `supabase/migrations/0001_init.sql`, and run it.

   Both are safe to repeat.
4. You do **not** need the project's API keys (anon or service role). TaskHub never uses them and they should not be put anywhere in this app.

## 2. Create your secrets

Three values. Generate them on your machine and keep them out of chat and Git.

| Variable | How |
| --- | --- |
| `TASKHUB_PASSWORD_HASH` | `npm run hash-password`, enter a password of 12+ characters (input is hidden). It prints the line to copy. |
| `TASKHUB_SESSION_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `TASKHUB_API_TOKEN` | Another 32+ random characters, same command. This is what the CLI and agents use. |

Without Node (PowerShell only), a random value is:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

(The password hash needs Node: run `npm run hash-password` in WSL.)

Put all four values (including `DATABASE_URL`) in a local `.env.local` if you want to run the app on your machine. `.env.local` is git-ignored.

## 3. Vercel (the hosting)

1. Put the project on GitHub as a **private** repo, from this folder:

   ```bash
   git add -A && git commit -m "TaskHub"
   gh repo create taskhub --private --source . --push
   ```

   Check `git status` first: no `.env*` file other than `.env.example` should be listed. If one is, stop.
2. vercel.com -> **Add New -> Project** -> import `taskhub`. The framework (Next.js) is detected automatically.
3. Before deploying, open **Environment Variables** and add these four, for Production (and Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the transaction pooler URI from step 1 |
   | `TASKHUB_PASSWORD_HASH` | from `npm run hash-password` |
   | `TASKHUB_SESSION_SECRET` | random 32+ characters |
   | `TASKHUB_API_TOKEN` | random 32+ characters |

4. **Deploy.** Open the URL, sign in with your password.
5. Optional but worthwhile: **Settings -> Functions -> Function Region** set to the region closest to your Supabase project. It removes most of the latency.

To rotate the API token later without breaking agents: set `TASKHUB_API_TOKEN` to `new,old`, redeploy, update the agents, then remove `old`.

## 4. Install the CLI

From the TaskHub folder on each machine/environment where you run agents:

```bash
npm install -g ./cli
taskhub login            # asks for the app URL, then the API token (hidden)
taskhub status
```

- **Windows PowerShell and WSL are separate environments**: install and `taskhub login` in each. The config lives in `~/.taskhub/config.json` (`%USERPROFILE%\.taskhub\config.json` on Windows). Alternatively set the `TASKHUB_URL` and `TASKHUB_TOKEN` environment variables.
- A global install from a folder normally links to it rather than copying it, so keep the TaskHub folder in place; if `taskhub` stops working after you move it, run the install again. (To install a standalone copy instead: `npm pack ./cli`, then `npm install -g taskhub-cli-0.1.0.tgz`.)
- If PowerShell says *"running scripts is disabled on this system"*, npm's `taskhub.ps1` shim is being blocked by the execution policy. Fix it once with:

  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

  or run `taskhub.cmd` instead of `taskhub`.
- `taskhub login` refuses plain `http://` URLs except for localhost, so a token is never sent unencrypted.

Try it in any project folder:

```bash
cd ~/some-project
taskhub init
taskhub add "First task"
taskhub list
```

The task appears in the web app immediately.

## 5. Connect Claude Code and Codex

```bash
npm run install-agent-instructions -- --dry-run     # preview only, writes nothing
npm run install-agent-instructions                  # shows each change and asks y/N per file
```

It appends one marked block (`<!-- taskhub:begin --> ... <!-- taskhub:end -->`) to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, after making a timestamped `.bak-` copy. It never overwrites anything else, and re-running it only refreshes its own block. `--uninstall` removes the block again.

You may have these files in more than one place (WSL home and Windows home). Point the script at each:

```bash
node scripts/install-agent-instructions.mjs --claude /mnt/c/Users/chris/.claude/CLAUDE.md --only claude
```

The text of the instructions is in `instructions/claude-snippet.md` and `instructions/codex-snippet.md`; edit those if you want different wording.

## 6. ChatGPT Work

See [CHATGPT-WORK.md](CHATGPT-WORK.md).

## Checklist of what you must supply

- [ ] Supabase project + its database password (step 1)
- [ ] The pooler connection string (step 1)
- [ ] A web password -> `TASKHUB_PASSWORD_HASH` (step 2)
- [ ] `TASKHUB_SESSION_SECRET` and `TASKHUB_API_TOKEN` (step 2)
- [ ] A Vercel project connected to the GitHub repo, with the four variables (step 3)
- [ ] Node.js on Windows if you want the CLI in PowerShell (step 0)

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Login says "The server is not configured" | `TASKHUB_SESSION_SECRET` is missing or under 32 characters, or neither password variable is set. Check the Vercel function logs. |
| API returns 500 `internal_error` | Usually `DATABASE_URL`: wrong password, direct (IPv6) URI instead of the pooler, or the migration was not run. The Vercel runtime logs show the real error. |
| `taskhub` says `sync FAILED ... could not reach` | Wrong URL, no network, or the Vercel project is paused. `taskhub status` shows which. |
| `taskhub` says the token is missing or wrong | The token in `~/.taskhub/config.json` differs from `TASKHUB_API_TOKEN`. Run `taskhub login` again. |
| Locked out after failed logins | Wait 15 minutes, or delete the rows: `delete from login_attempts;` in the Supabase SQL editor. |

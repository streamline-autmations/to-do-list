# TaskHub

One private checklist for you and your AI agents. A small web app, one Postgres database, and a `taskhub` command that Claude Code, Codex and you can all run from any project folder. There is no local task database anywhere: the web app and the CLI read and write the same central data.

- **Web app**: projects in a sidebar, a checklist per project, an "All projects" view. Tick to complete, click a title to edit, Enter to add.
- **CLI** (`taskhub`): `status`, `projects`, `init`, `list`, `add`, `done`, `reopen`, `edit`, `delete`, `login`. Identifies the project from the Git remote or the folder, and never creates duplicates.
- **API**: documented in [docs/API.md](docs/API.md). Bearer token for machines, signed cookie for the browser.
- **Agent instructions**: short snippets for `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, installed by an append-only script that asks first.

Stack: Next.js 16 (App Router) + TypeScript, Tailwind CSS 4, Supabase Postgres, Vercel. Runtime dependencies: `next`, `react`, `react-dom`, `postgres`. Nothing else.

## Quick start (local, no accounts needed)

```bash
npm install
npm run dev:db                      # terminal 1: a local throwaway Postgres (PGlite)
cp .env.example .env.local          # then fill it in; see below
npm run dev                         # terminal 2: http://localhost:3000
```

For local use, `.env.local` needs:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
TASKHUB_DB_POOL_MAX=1
TASKHUB_PASSWORD_HASH=...      # npm run hash-password
TASKHUB_SESSION_SECRET=...     # 32+ random characters
TASKHUB_API_TOKEN=...          # 32+ random characters
```

Generate the random values with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Deploy for real

Follow **[docs/SETUP.md](docs/SETUP.md)**: create a Supabase project, run the migration, deploy to Vercel, install the CLI, connect your agents. It lists exactly which credentials go where.

## Daily use

```text
taskhub init                    register this folder's project (safe to repeat)
taskhub add "Finish product import" --notes "CSV is in Drive"
taskhub list                    open tasks for this project
taskhub list --all-projects     everything outstanding, grouped by project
taskhub done 3f2a9c1b           8 characters of the id is enough
taskhub status                  connection, auth, and which project this folder is
```

## Project layout

```
src/app/            pages and API route handlers (src/app/api/**/route.ts)
src/lib/            auth, data access (repo.ts), validation, project identity
src/components/     the client UI
supabase/migrations the schema (idempotent)
cli/taskhub.mjs     the CLI (zero dependencies, Node 18+)
instructions/       snippets for CLAUDE.md and AGENTS.md
scripts/            hash-password, migrate, dev-db, install-agent-instructions
tests/              API, auth, identity and CLI tests (real Postgres via PGlite)
docs/               SETUP, API, CHATGPT-WORK
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | 85 tests: API, auth, concurrency, CLI end to end, installer |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run hash-password` | Prints `TASKHUB_PASSWORD_HASH` for your chosen password (hidden prompt) |
| `npm run migrate` | Applies `supabase/migrations/*.sql` to `DATABASE_URL` |
| `npm run dev:db` | Local Postgres for development |
| `npm run install-agent-instructions` | Safely adds the TaskHub block to your agent instruction files |

## Security model, briefly

- The database URL is a server-only secret. The browser never talks to Supabase; the tables have row-level security on with no policies, so Supabase's public API can read nothing even if someone has your project URL.
- Web login: one password, stored only as a scrypt hash. Sessions are an HMAC-signed, HttpOnly, SameSite cookie. Failed logins are throttled per IP (8 per 15 minutes).
- Agents and the CLI: a bearer token from `TASKHUB_API_TOKEN`. You can set two comma-separated tokens to rotate without downtime.
- Cookie-authenticated writes are checked against the request's Origin (CSRF). Responses are `no-store`.
- Secrets live in environment variables and `~/.taskhub/config.json` (mode 600). `.gitignore` excludes every `.env*` file except `.env.example`.

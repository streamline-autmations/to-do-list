# TaskHub API

Base URL: your deployment, e.g. `https://taskhub.example.com`. All bodies and responses are JSON. Everything is under `/api`.

## Authentication

Every endpoint except login and logout needs one of:

- **Machines (CLI, agents, scripts)**: `Authorization: Bearer <TASKHUB_API_TOKEN>`
- **Browser**: the `taskhub_session` cookie from `POST /api/auth/login`. Writes made with the cookie must come from the same origin (CSRF check); bearer-token calls are not affected.

A request with a bad or missing credential gets `401`. A bad bearer token never falls back to a cookie.

## Conventions

- **Errors** always look like `{"error": {"code": "not_found", "message": "Task not found"}}`.

  | Status | Codes |
  | --- | --- |
  | 400 | `invalid_request`, `payload_too_large` |
  | 401 | `unauthorized`, `invalid_credentials` |
  | 403 | `forbidden` (cross-origin cookie write) |
  | 404 | `not_found` |
  | 409 | `conflict`, `name_in_use`, `repo_url_in_use`, `local_key_in_use`, `duplicate_task`, `ambiguous_id`, `retry` |
  | 429 | `too_many_attempts` (login lockout) |
  | 500 | `internal_error`, `not_configured` |

- **Unknown fields are rejected** with 400, so typos fail loudly.
- **Task ids** are UUIDs. Any task endpoint also accepts a unique hex **prefix of 6+ characters** (the CLI shows 8). An ambiguous prefix is `409 ambiguous_id`.
- **Timestamps** are ISO 8601 UTC.
- **Limits**: project name 120 characters, task title 300, notes 10,000, request body 100 KB.
- **Safe concurrency**: updates change only the fields you send, so two agents editing different tasks (or different fields of one task) never overwrite each other. Completing and reopening are idempotent.

## Project identity

A project can be matched by a normalised **repository URL** and/or a normalised **local directory**. You may send either raw; the server normalises both.

- `https://user:token@GitHub.com/Acme/Shop.git`, `git@github.com:acme/shop.git`, `ssh://git@github.com/acme/shop` all become `github.com/acme/shop`.
- `C:\Code\Shop\` and `/mnt/c/Code/Shop` both become `c:/code/shop`. `\\wsl.localhost\Ubuntu\home\me\app` becomes `/home/me/app`.

Both are unique across projects, as is the project name (case-insensitively).

## Endpoints

### Auth

`POST /api/auth/login` `{"password": "..."}` -> `200 {"ok": true}` and a `Set-Cookie`. `401` for a wrong password; after 8 failures from one IP in 15 minutes, `429`.
`POST /api/auth/logout` -> clears the cookie.

### Health

`GET /api/health` -> `{"ok": true, "database": true}`. Authenticated; proves the token works and the database is reachable.

### Projects

| | |
| --- | --- |
| `GET /api/projects` | `{"projects": [{id, name, repo_url, local_key, created_at, updated_at, open_count, done_count}]}`, sorted by name |
| `POST /api/projects` | body `{name, repo_url?, local_key?}` -> `201 {"project": {...}}`; `409` if the name, repo or directory is taken |
| `GET /api/projects/find?repo_url=&local_key=` | `200 {"project": {...}, "matched_by": "repo_url" \| "local_key"}` or `404`. Repo URL is tried first. |
| `POST /api/projects/ensure` | **Idempotent register.** body `{name?, repo_url?, local_key?}` (at least one). -> `201` when created, `200` when it already existed: `{"project": {...}, "created": bool, "matched_by": ...}` |
| `GET /api/projects/:id` | `{"project": {...}}` |
| `PATCH /api/projects/:id` | any of `{name, repo_url, local_key}`; `null` clears a repo or directory |
| `DELETE /api/projects/:id` | deletes the project **and its tasks**. `{"ok": true}` |

`ensure` matches by repo URL, then directory, then by name (only when that cannot be a different project: a same-named project with a conflicting repo or directory gives `409 name_in_use`). When it matches, it fills in any identifier the project was missing. It is safe to call from many agents at once: concurrent callers are serialised and the unique indexes are the backstop.

### Tasks

Task object: `{id, project_id, title, notes, completed, position, created_at, completed_at, updated_at}`. List results also carry `project_name`.

| | |
| --- | --- |
| `GET /api/tasks?project_id=&status=&limit=` | `status` is `open` (default), `done` or `all`; `limit` 1-2000 (default 500); omit `project_id` for every project. Open tasks come first, ordered by `position` then creation; completed ones follow, newest first. |
| `POST /api/tasks` | body `{project_id, title, notes?}` -> `201 {"task": {...}, "created": true}`. If an **open** task with the same title (case and spacing ignored) exists in that project, nothing is created: `200 {"task": <existing>, "created": false}` |
| `GET /api/tasks/:id` | `{"task": {...}}` |
| `PATCH /api/tasks/:id` | any of `{title, notes, completed, position}`; at least one. `notes: null` clears. Reopening or renaming into a duplicate of another open task is `409 duplicate_task`. |
| `POST /api/tasks/:id/complete` | idempotent; keeps the original `completed_at` if already done |
| `POST /api/tasks/:id/reopen` | idempotent |
| `DELETE /api/tasks/:id` | `{"ok": true}` |

## Examples

```bash
export TH=https://taskhub.example.com
export AUTH="Authorization: Bearer $TASKHUB_TOKEN"

# register (or find) a project, safely, from anywhere
curl -sX POST $TH/api/projects/ensure -H "$AUTH" -H 'content-type: application/json' \
  -d '{"repo_url":"git@github.com:acme/shop.git","local_key":"/home/me/shop"}'

# add a task
curl -sX POST $TH/api/tasks -H "$AUTH" -H 'content-type: application/json' \
  -d '{"project_id":"<uuid>","title":"Finish product import","notes":"CSV is in Drive"}'

# open tasks for a project
curl -s "$TH/api/tasks?project_id=<uuid>" -H "$AUTH"

# complete by id prefix
curl -sX POST $TH/api/tasks/3f2a9c1b/complete -H "$AUTH"
```

-- TaskHub schema. Idempotent: safe to run more than once.
-- Run via `npm run migrate`, or paste into Supabase -> SQL Editor.

-- ---------------------------------------------------------------- helpers
create or replace function taskhub_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------------- projects
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Normalised "host/owner/repo" (lowercase, no scheme, credentials or .git).
  repo_url    text,
  -- Normalised local directory identifier, e.g. "c:/users/me/code/app".
  local_key   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_name_len     check (char_length(btrim(name)) between 1 and 120),
  constraint projects_repo_len     check (repo_url  is null or char_length(repo_url)  between 1 and 300),
  constraint projects_local_len    check (local_key is null or char_length(local_key) between 1 and 500)
);

-- No duplicate projects, however many agents start at once.
create unique index if not exists projects_name_key      on projects (lower(btrim(name)));
create unique index if not exists projects_repo_url_key  on projects (repo_url)  where repo_url  is not null;
create unique index if not exists projects_local_key_key on projects (local_key) where local_key is not null;

drop trigger if exists projects_touch on projects;
create trigger projects_touch before update on projects
  for each row execute function taskhub_touch_updated_at();

-- ------------------------------------------------------------------ tasks
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects (id) on delete cascade,
  title         text not null,
  notes         text,
  completed     boolean not null default false,
  -- Optional manual order; ties fall back to created_at.
  position      double precision not null default 0,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  constraint tasks_title_len   check (char_length(btrim(title)) between 1 and 300),
  constraint tasks_notes_len   check (notes is null or char_length(notes) <= 10000),
  constraint tasks_completed_consistent check (completed = (completed_at is not null))
);

-- At most one OPEN task per title per project (case/space-insensitive).
-- A finished task can be re-added later; agents that retry never create duplicates.
create unique index if not exists tasks_open_title_key
  on tasks (project_id, lower(btrim(title))) where not completed;

create index if not exists tasks_project_idx on tasks (project_id, completed, position, created_at);
create index if not exists tasks_open_idx    on tasks (completed, created_at) where not completed;

drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks
  for each row execute function taskhub_touch_updated_at();

-- ---------------------------------------------------------- login throttle
-- Failed web-login attempts, per client IP. Pruned automatically by the app.
create table if not exists login_attempts (
  id            bigint generated always as identity primary key,
  ip            text not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists login_attempts_ip_idx on login_attempts (ip, attempted_at);

-- --------------------------------------------------------------- security
-- The app talks to Postgres directly with a server-only connection string.
-- Enabling RLS with NO policies means Supabase's public REST/GraphQL API
-- (anon / authenticated roles) can read or write nothing here.
alter table projects       enable row level security;
alter table tasks          enable row level security;
alter table login_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on projects, tasks, login_attempts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on projects, tasks, login_attempts from authenticated;
  end if;
end
$$;

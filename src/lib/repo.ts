import { getSql, pgCode, pgConstraint, type Sql } from "./db";
import { badRequest, conflict, notFound } from "./errors";
import { deriveName } from "./identity";
import { isIdPrefix, isUuid } from "./validate";

// ------------------------------------------------------------------- types

export interface Project {
  id: string;
  name: string;
  repo_url: string | null;
  local_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithCounts extends Project {
  open_count: number;
  done_count: number;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  completed: boolean;
  position: number;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface ListedTask extends Task {
  project_name: string;
}

type Row = Record<string, unknown>;
type DbDate = Date | string | null;

const iso = (d: DbDate): string | null => (d === null ? null : new Date(d).toISOString());

const toProject = (r: Row): Project => ({
  id: r.id as string,
  name: r.name as string,
  repo_url: (r.repo_url as string | null) ?? null,
  local_key: (r.local_key as string | null) ?? null,
  created_at: iso(r.created_at as DbDate)!,
  updated_at: iso(r.updated_at as DbDate)!,
});

const toTask = (r: Row): Task => ({
  id: r.id as string,
  project_id: r.project_id as string,
  title: r.title as string,
  notes: (r.notes as string | null) ?? null,
  completed: r.completed as boolean,
  position: Number(r.position),
  created_at: iso(r.created_at as DbDate)!,
  completed_at: iso((r.completed_at as DbDate) ?? null),
  updated_at: iso(r.updated_at as DbDate)!,
});

// ---------------------------------------------------------------- projects

export async function listProjects(): Promise<ProjectWithCounts[]> {
  const sql = getSql();
  const rows = await sql<Row[]>`
    select p.*,
           count(t.id) filter (where not t.completed)::int as open_count,
           count(t.id) filter (where t.completed)::int     as done_count
    from projects p
    left join tasks t on t.project_id = p.id
    group by p.id
    order by lower(p.name), p.created_at`;
  return rows.map((r) => ({ ...toProject(r), open_count: r.open_count as number, done_count: r.done_count as number }));
}

export async function getProject(id: string): Promise<Project> {
  const sql = getSql();
  const [row] = await sql<Row[]>`select * from projects where id = ${id}`;
  if (!row) throw notFound("Project");
  return toProject(row);
}

/** Look a project up by repository URL first, then by local directory. Inputs must be normalised. */
export async function findProject(
  q: { repo_url?: string | null; local_key?: string | null },
  sql: Sql = getSql(),
): Promise<{ project: Project; matched_by: "repo_url" | "local_key" } | null> {
  if (q.repo_url) {
    const [row] = await sql<Row[]>`select * from projects where repo_url = ${q.repo_url}`;
    if (row) return { project: toProject(row), matched_by: "repo_url" };
  }
  if (q.local_key) {
    const [row] = await sql<Row[]>`select * from projects where local_key = ${q.local_key}`;
    if (row) {
      const project = toProject(row);
      // The folder now holds a different repository than the one registered here: not the same project.
      const otherRepo = q.repo_url && project.repo_url && project.repo_url !== q.repo_url;
      if (!otherRepo) return { project, matched_by: "local_key" };
    }
  }
  return null;
}

function mapProjectConflict(err: unknown): never {
  if (pgCode(err) === "23505") {
    const c = pgConstraint(err);
    if (c === "projects_repo_url_key") throw conflict("Another project already uses this repository URL", "repo_url_in_use");
    if (c === "projects_local_key_key") throw conflict("Another project already uses this directory", "local_key_in_use");
    throw conflict("A project with this name already exists", "name_in_use");
  }
  throw err;
}

export async function createProject(input: {
  name: string;
  repo_url: string | null;
  local_key: string | null;
}): Promise<Project> {
  const sql = getSql();
  try {
    const [row] = await sql<Row[]>`
      insert into projects (name, repo_url, local_key)
      values (${input.name}, ${input.repo_url}, ${input.local_key})
      returning *`;
    return toProject(row!);
  } catch (err) {
    return mapProjectConflict(err);
  }
}

export async function updateProject(
  id: string,
  patch: { name?: string; repo_url?: string | null; local_key?: string | null },
): Promise<Project> {
  const sql = getSql();
  try {
    const [row] = await sql<Row[]>`
      update projects set
        name      = coalesce(${patch.name ?? null}::text, name),
        repo_url  = case when ${patch.repo_url !== undefined} then ${patch.repo_url ?? null}::text else repo_url end,
        local_key = case when ${patch.local_key !== undefined} then ${patch.local_key ?? null}::text else local_key end
      where id = ${id}
      returning *`;
    if (!row) throw notFound("Project");
    return toProject(row);
  } catch (err) {
    return mapProjectConflict(err);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const sql = getSql();
  const rows = await sql`delete from projects where id = ${id} returning id`;
  if (rows.length === 0) throw notFound("Project");
}

const ENSURE_LOCK = 727_001;

/**
 * Find-or-create, safe to call from many agents at once.
 *
 * Match order: repository URL, then local directory, then (when it cannot be a
 * different project) name. A transaction-scoped advisory lock serialises
 * concurrent callers, and the unique indexes remain the final guard.
 */
export async function ensureProject(input: {
  name: string | null;
  repo_url: string | null;
  local_key: string | null;
}): Promise<{ project: Project; created: boolean; matched_by: "repo_url" | "local_key" | "name" | null }> {
  const sql = getSql();
  try {
    return await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${ENSURE_LOCK})`;

      let existing: Project | null = null;
      let matchedBy: "repo_url" | "local_key" | "name" | null = null;

      const hit = await findProject(input, tx as unknown as Sql);
      if (hit) {
        existing = hit.project;
        matchedBy = hit.matched_by;
      }

      // A folder can only hold one repository at a time. If it was registered under a different repo,
      // that registration is stale: release the folder (the old project keeps its repo identity).
      if (input.local_key && input.repo_url) {
        await tx`
          update projects set local_key = null
          where local_key = ${input.local_key} and repo_url is not null and repo_url <> ${input.repo_url}`;
      }

      const derived = deriveName(input.repo_url, input.local_key);
      const name = input.name ?? (derived ? derived.slice(0, 120) : null);
      if (!existing) {
        if (!name) throw badRequest("Provide at least one of: name, repo_url, local_key");
        const [byName] = await tx<Row[]>`select * from projects where lower(btrim(name)) = lower(btrim(${name}))`;
        if (byName) {
          const cand = toProject(byName);
          // Same name but a different repo or directory: a genuinely different project.
          const clashes =
            (input.repo_url && cand.repo_url && cand.repo_url !== input.repo_url) ||
            (input.local_key && cand.local_key && cand.local_key !== input.local_key);
          if (clashes) {
            throw conflict(
              `A different project named '${cand.name}' already exists. Pass an explicit name to register this one.`,
              "name_in_use",
            );
          }
          existing = cand;
          matchedBy = "name";
        }
      }

      if (existing) {
        // Fill in identifiers we have learned, unless another project already owns them.
        const [row] = await tx<Row[]>`
          update projects p set
            repo_url  = coalesce(p.repo_url, case when ${input.repo_url}::text is not null
                          and not exists (select 1 from projects o where o.repo_url = ${input.repo_url}::text)
                          then ${input.repo_url}::text end),
            local_key = coalesce(p.local_key, case when ${input.local_key}::text is not null
                          and not exists (select 1 from projects o where o.local_key = ${input.local_key}::text)
                          then ${input.local_key}::text end)
          where p.id = ${existing.id}
          returning p.*`;
        return { project: toProject(row!), created: false, matched_by: matchedBy };
      }

      const [row] = await tx<Row[]>`
        insert into projects (name, repo_url, local_key)
        values (${name!}, ${input.repo_url}, ${input.local_key})
        returning *`;
      return { project: toProject(row!), created: true, matched_by: null };
    });
  } catch (err) {
    if (pgCode(err) === "23505") return mapProjectConflict(err);
    throw err;
  }
}

// ------------------------------------------------------------------- tasks

export type TaskStatus = "open" | "done" | "all";

export async function listTasks(opts: {
  project_id?: string;
  status: TaskStatus;
  limit: number;
}): Promise<ListedTask[]> {
  const sql = getSql();
  const rows = await sql<Row[]>`
    select t.*, p.name as project_name
    from tasks t
    join projects p on p.id = t.project_id
    where (${opts.project_id ?? null}::uuid is null or t.project_id = ${opts.project_id ?? null}::uuid)
      and (${opts.status}::text = 'all'
           or (${opts.status}::text = 'open' and not t.completed)
           or (${opts.status}::text = 'done' and t.completed))
    order by t.completed asc,
             case when t.completed then 0 else t.position end asc,
             t.completed_at desc nulls last,
             t.created_at asc,
             t.id asc
    limit ${opts.limit}`;
  return rows.map((r) => ({ ...toTask(r), project_name: r.project_name as string }));
}

export async function getTask(id: string): Promise<Task> {
  const sql = getSql();
  const [row] = await sql<Row[]>`select * from tasks where id = ${id}`;
  if (!row) throw notFound("Task");
  return toTask(row);
}

/** Accepts a full UUID or a unique hex prefix (>= 6 chars), as printed by the CLI. */
export async function resolveTaskId(idOrPrefix: string): Promise<string> {
  const v = idOrPrefix.trim().toLowerCase();
  if (isUuid(v)) return v;
  const hex = v.replace(/-/g, ""); // "12345678-abcd" and "12345678abcd" are the same prefix
  if (!isIdPrefix(hex)) throw badRequest("Task id must be a UUID or a hex prefix of at least 6 characters");
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    select id from tasks where replace(id::text, '-', '') like ${hex + "%"} limit 2`;
  if (rows.length === 0) throw notFound("Task");
  if (rows.length > 1) throw conflict(`Task id prefix '${v}' is ambiguous; use more characters`, "ambiguous_id");
  return rows[0]!.id;
}

function mapTaskConflict(err: unknown): never {
  if (pgCode(err) === "23505") {
    throw conflict("An open task with this title already exists in this project", "duplicate_task");
  }
  throw err;
}

/**
 * Create a task, or return the existing open task with the same title.
 * Retried or concurrent agent calls therefore never produce duplicates.
 */
export async function createTask(input: {
  project_id: string;
  title: string;
  notes: string | null;
}): Promise<{ task: Task; created: boolean }> {
  const sql = getSql();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [inserted] = await sql<Row[]>`
        insert into tasks (project_id, title, notes)
        values (${input.project_id}, ${input.title}, ${input.notes})
        on conflict (project_id, lower(btrim(title))) where not completed do nothing
        returning *`;
      if (inserted) return { task: toTask(inserted), created: true };

      const [existing] = await sql<Row[]>`
        select * from tasks
        where project_id = ${input.project_id} and not completed
          and lower(btrim(title)) = lower(btrim(${input.title}))`;
      if (existing) return { task: toTask(existing), created: false };
      // The other task was completed or deleted between the two statements: try again.
    } catch (err) {
      if (pgCode(err) === "23503") throw notFound("Project");
      throw err;
    }
  }
  throw conflict("Could not create the task because of concurrent changes; please retry", "retry");
}

export async function updateTask(
  id: string,
  patch: { title?: string; notes?: string | null; completed?: boolean; position?: number },
): Promise<Task> {
  const sql = getSql();
  try {
    // Only the fields present in `patch` change, so concurrent edits to
    // different fields (or different tasks) never overwrite each other.
    const [row] = await sql<Row[]>`
      update tasks set
        title        = coalesce(${patch.title ?? null}::text, title),
        notes        = case when ${patch.notes !== undefined} then ${patch.notes ?? null}::text else notes end,
        position     = coalesce(${patch.position ?? null}::double precision, position),
        completed    = coalesce(${patch.completed ?? null}::boolean, completed),
        completed_at = case
                         when ${patch.completed ?? null}::boolean is null then completed_at
                         when ${patch.completed ?? null}::boolean then coalesce(completed_at, now())
                         else null
                       end
      where id = ${id}
      returning *`;
    if (!row) throw notFound("Task");
    return toTask(row);
  } catch (err) {
    return mapTaskConflict(err);
  }
}

export async function deleteTask(id: string): Promise<void> {
  const sql = getSql();
  const rows = await sql`delete from tasks where id = ${id} returning id`;
  if (rows.length === 0) throw notFound("Task");
}

import { parseStatus } from "@/lib/inputs";
import { json, route } from "@/lib/http";
import { createTask, listTasks } from "@/lib/repo";
import { intParam, onlyKeys, optString, readJson, reqString, requireUuid } from "@/lib/validate";

/** GET /api/tasks?project_id=<uuid>&status=open|done|all&limit=500 (omit project_id for all projects). */
export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const project = p.get("project_id");
  const tasks = await listTasks({
    ...(project ? { project_id: requireUuid(project, "project_id") } : {}),
    status: parseStatus(p.get("status")),
    limit: intParam(p.get("limit"), 500, 1, 2000, "limit"),
  });
  return { tasks };
});

/** POST /api/tasks - returns 201 when created, 200 with created:false if an identical open task exists. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  onlyKeys(body, ["project_id", "title", "notes"]);
  const project_id = requireUuid(reqString(body, "project_id", { max: 36 }), "project_id");
  const title = reqString(body, "title", { max: 300, collapse: true });
  const notes = optString(body, "notes", { max: 10_000 }) ?? null;
  const result = await createTask({ project_id, title, notes });
  return json(result, result.created ? 201 : 200);
});

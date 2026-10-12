import { badRequest } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { deleteTask, getTask, resolveTaskId, updateTask } from "@/lib/repo";
import { onlyKeys, optBool, optNumber, optString, readJson } from "@/lib/validate";

type P = { id: string };

export const GET = route<P>(async (_req, { params }) => ({ task: await getTask(await resolveTaskId(params.id)) }));

/** PATCH changes only the fields you send. `completed` is idempotent. */
export const PATCH = route<P>(async (req, { params }) => {
  const id = await resolveTaskId(params.id);
  const body = await readJson(req);
  onlyKeys(body, ["title", "notes", "completed", "position"]);

  const title = optString(body, "title", { max: 300, collapse: true });
  if (title === null) throw badRequest("'title' must not be empty");
  const notes = optString(body, "notes", { max: 10_000 });
  const completed = optBool(body, "completed");
  const position = optNumber(body, "position");
  if (title === undefined && notes === undefined && completed === undefined && position === undefined) {
    throw badRequest("Nothing to update. Send at least one of: title, notes, completed, position");
  }

  const task = await updateTask(id, {
    ...(title !== undefined ? { title } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(completed !== undefined ? { completed } : {}),
    ...(position !== undefined ? { position } : {}),
  });
  return { task };
});

export const DELETE = route<P>(async (_req, { params }) => {
  await deleteTask(await resolveTaskId(params.id));
  return json({ ok: true });
});

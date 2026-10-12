import { route } from "@/lib/http";
import { resolveTaskId, updateTask } from "@/lib/repo";

/** Idempotent: calling it on a task that is already open is a no-op that returns the task. */
export const POST = route<{ id: string }>(async (_req, { params }) => ({
  task: await updateTask(await resolveTaskId(params.id), { completed: false }),
}));

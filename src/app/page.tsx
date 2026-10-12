import { TaskHubApp } from "@/components/taskhub-app";
import { requireSession } from "@/lib/page-auth";
import { listProjects, listTasks } from "@/lib/repo";
import { isUuid } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();

  const sp = await searchParams;
  const wanted = typeof sp.p === "string" ? sp.p : "all";
  const projects = await listProjects();
  const view = isUuid(wanted) && projects.some((p) => p.id === wanted) ? wanted : "all";

  const tasks = await listTasks(
    view === "all" ? { status: "all", limit: 1000 } : { project_id: view, status: "all", limit: 500 },
  );

  return <TaskHubApp initialProjects={projects} initialTasks={tasks} initialView={view} />;
}

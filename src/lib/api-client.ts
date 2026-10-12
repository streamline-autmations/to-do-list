"use client";

import type { ListedTask, Project, ProjectWithCounts, Task } from "./repo";

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiFailure(0, "Can't reach the server. Check your connection.");
  }
  if (res.status === 401) {
    window.location.assign("/login");
    throw new ApiFailure(401, "Signed out");
  }
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new ApiFailure(res.status, data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export const http = {
  projects: () => call<{ projects: ProjectWithCounts[] }>("GET", "/api/projects"),
  tasks: (query: string) => call<{ tasks: ListedTask[] }>("GET", `/api/tasks?${query}`),
  createProject: (name: string) => call<{ project: Project }>("POST", "/api/projects", { name }),
  renameProject: (id: string, name: string) => call<{ project: Project }>("PATCH", `/api/projects/${id}`, { name }),
  deleteProject: (id: string) => call<{ ok: true }>("DELETE", `/api/projects/${id}`),
  createTask: (project_id: string, title: string) =>
    call<{ task: Task; created: boolean }>("POST", "/api/tasks", { project_id, title }),
  patchTask: (id: string, patch: { title?: string; notes?: string | null; completed?: boolean }) =>
    call<{ task: Task }>("PATCH", `/api/tasks/${id}`, patch),
  deleteTask: (id: string) => call<{ ok: true }>("DELETE", `/api/tasks/${id}`),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),
};

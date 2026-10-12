"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, http } from "@/lib/api-client";
import type { ListedTask, ProjectWithCounts } from "@/lib/repo";
import { AddTask } from "./add-task";
import { ChevronIcon } from "./icons";
import { ProjectNav, Sidebar, Wordmark } from "./sidebar";
import { TaskRow } from "./task-row";

interface Props {
  initialProjects: ProjectWithCounts[];
  initialTasks: ListedTask[];
  initialView: string;
}

type Cache = Record<string, ListedTask[]>;
interface Notice {
  kind: "error" | "info";
  text: string;
}

const SETTLE_MS = 750; // how long a ticked task stays in place so the strike-through is seen
const POLL_MS = 15_000;
const HIDE_KEY = "taskhub.hideCompleted";

const byOrder = (a: ListedTask, b: ListedTask) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
const byRecentlyDone = (a: ListedTask, b: ListedTask) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
const byName = (a: ProjectWithCounts, b: ProjectWithCounts) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const message = (e: unknown) => (e instanceof ApiFailure || e instanceof Error ? e.message : "Something went wrong.");

export function TaskHubApp({ initialProjects, initialTasks, initialView }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [cache, setCache] = useState<Cache>({ [initialView]: initialTasks });
  const [view, setView] = useState(initialView);
  const [hideDone, setHideDone] = useState(false);
  const [settling, setSettling] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);

  const pending = useRef(0); // in-flight writes; polling pauses while > 0
  const epoch = useRef(0); // bumped around every write so stale poll results are discarded
  const tmpSeq = useRef(0);
  const settleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstLoad = useRef(true);

  const project = view === "all" ? null : (projects.find((p) => p.id === view) ?? null);

  // ----------------------------------------------------------------- helpers

  const flash = useCallback((text: string, kind: Notice["kind"] = "error") => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, kind });
    noticeTimer.current = setTimeout(() => setNotice(null), kind === "error" ? 7000 : 3500);
  }, []);

  const begin = () => {
    pending.current++;
    epoch.current++;
  };
  const end = () => {
    pending.current--;
    epoch.current++;
  };

  const mapCache = useCallback((fn: (list: ListedTask[], key: string) => ListedTask[]) => {
    setCache((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, fn(v, k)])));
  }, []);

  const patchTask = useCallback(
    (id: string, patch: Partial<ListedTask>) => mapCache((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [mapCache],
  );
  const removeTask = useCallback((id: string) => mapCache((list) => list.filter((t) => t.id !== id)), [mapCache]);
  const insertTask = useCallback(
    (task: ListedTask) =>
      mapCache((list, key) => (key === "all" || key === task.project_id ? [...list.filter((t) => t.id !== task.id), task] : list)),
    [mapCache],
  );
  const bumpCounts = useCallback((projectId: string, open: number, done: number) => {
    setProjects((ps) =>
      ps.map((p) => (p.id === projectId ? { ...p, open_count: Math.max(0, p.open_count + open), done_count: Math.max(0, p.done_count + done) } : p)),
    );
  }, []);

  const settle = useCallback((id: string, wasCompleted: boolean) => {
    clearTimeout(settleTimers.current[id]);
    setSettling((s) => ({ ...s, [id]: wasCompleted }));
    settleTimers.current[id] = setTimeout(() => {
      setSettling(({ [id]: _gone, ...rest }) => rest);
      delete settleTimers.current[id];
    }, SETTLE_MS);
  }, []);

  // ------------------------------------------------------------ navigation

  const selectView = useCallback((v: string) => {
    setView(v);
    setNavOpen(false);
    setRenaming(false);
    setConfirmDeleteProject(false);
    window.history.pushState(null, "", v === "all" ? "/" : `/?p=${v}`);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search).get("p");
      setView(p ?? "all");
      setNavOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A project deleted elsewhere (or a stale link) falls back to All projects.
  useEffect(() => {
    if (view !== "all" && !projects.some((p) => p.id === view)) setView("all");
  }, [view, projects]);

  useEffect(() => {
    try {
      setHideDone(localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      /* storage unavailable: default is fine */
    }
  }, []);

  const toggleHideDone = () => {
    setHideDone((h) => {
      try {
        localStorage.setItem(HIDE_KEY, h ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !h;
    });
  };

  // ----------------------------------------------------------------- syncing

  const load = useCallback(async (v: string) => {
    if (pending.current > 0) return;
    const started = epoch.current;
    try {
      const query = v === "all" ? "status=all&limit=1000" : `project_id=${v}&status=all&limit=500`;
      const [t, p] = await Promise.all([http.tasks(query), http.projects()]);
      if (epoch.current !== started || pending.current > 0) return; // a write happened meanwhile
      setCache((c) => ({ ...c, [v]: t.tasks }));
      setProjects(p.projects);
    } catch {
      /* background refresh: stay quiet, the next poll retries */
    }
  }, []);

  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false; // the server already rendered this view
      return;
    }
    void load(view);
  }, [view, load]);

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void load(view);
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [view, load]);

  // --------------------------------------------------------------- mutations

  const toggle = useCallback(
    async (task: ListedTask) => {
      if (task.id.startsWith("tmp-")) return;
      const next = !task.completed;
      begin();
      patchTask(task.id, { completed: next, completed_at: next ? new Date().toISOString() : null });
      bumpCounts(task.project_id, next ? -1 : 1, next ? 1 : -1);
      settle(task.id, task.completed);
      try {
        const { task: saved } = await http.patchTask(task.id, { completed: next });
        patchTask(task.id, saved);
      } catch (e) {
        patchTask(task.id, { completed: task.completed, completed_at: task.completed_at });
        bumpCounts(task.project_id, next ? 1 : -1, next ? -1 : 1);
        flash(`Couldn't ${next ? "complete" : "reopen"} that task. ${message(e)}`);
      } finally {
        end();
      }
    },
    [patchTask, bumpCounts, settle, flash],
  );

  const editTitle = useCallback(
    async (task: ListedTask, title: string) => {
      begin();
      patchTask(task.id, { title });
      try {
        const { task: saved } = await http.patchTask(task.id, { title });
        patchTask(task.id, saved);
      } catch (e) {
        patchTask(task.id, { title: task.title });
        flash(`Couldn't rename the task. ${message(e)}`);
      } finally {
        end();
      }
    },
    [patchTask, flash],
  );

  const editNotes = useCallback(
    async (task: ListedTask, notes: string | null) => {
      begin();
      patchTask(task.id, { notes });
      try {
        const { task: saved } = await http.patchTask(task.id, { notes });
        patchTask(task.id, saved);
      } catch (e) {
        patchTask(task.id, { notes: task.notes });
        flash(`Couldn't save the notes. ${message(e)}`);
      } finally {
        end();
      }
    },
    [patchTask, flash],
  );

  const removeOne = useCallback(
    async (task: ListedTask) => {
      begin();
      removeTask(task.id);
      bumpCounts(task.project_id, task.completed ? 0 : -1, task.completed ? -1 : 0);
      try {
        await http.deleteTask(task.id);
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 404) return; // already gone
        insertTask(task);
        bumpCounts(task.project_id, task.completed ? 0 : 1, task.completed ? 1 : 0);
        flash(`Couldn't delete the task. ${message(e)}`);
      } finally {
        end();
      }
    },
    [removeTask, insertTask, bumpCounts, flash],
  );

  const addTask = useCallback(
    async (projectId: string, title: string): Promise<boolean> => {
      const owner = projects.find((p) => p.id === projectId);
      if (!owner) return false;
      const now = new Date().toISOString();
      const tmp: ListedTask = {
        id: `tmp-${++tmpSeq.current}`,
        project_id: projectId,
        project_name: owner.name,
        title,
        notes: null,
        completed: false,
        position: 0,
        created_at: now,
        completed_at: null,
        updated_at: now,
      };
      begin();
      insertTask(tmp);
      bumpCounts(projectId, 1, 0);
      try {
        const { task, created } = await http.createTask(projectId, title);
        mapCache((list, key) => {
          if (!list.some((t) => t.id === tmp.id)) return list;
          const without = list.filter((t) => t.id !== tmp.id);
          const keep = key === "all" || key === projectId;
          return keep && !without.some((t) => t.id === task.id) ? [...without, { ...task, project_name: owner.name }] : without;
        });
        if (!created) {
          bumpCounts(projectId, -1, 0);
          flash("That's already on the list.", "info");
        }
        return true;
      } catch (e) {
        removeTask(tmp.id);
        bumpCounts(projectId, -1, 0);
        flash(`Couldn't add the task. ${message(e)}`);
        return false;
      } finally {
        end();
      }
    },
    [projects, insertTask, bumpCounts, mapCache, removeTask, flash],
  );

  const addProject = useCallback(
    async (name: string): Promise<boolean> => {
      begin();
      try {
        const { project: created } = await http.createProject(name);
        setProjects((ps) => [...ps, { ...created, open_count: 0, done_count: 0 }].sort(byName));
        setCache((c) => ({ ...c, [created.id]: [] }));
        selectView(created.id);
        return true;
      } catch (e) {
        flash(`Couldn't add the project. ${message(e)}`);
        return false;
      } finally {
        end();
      }
    },
    [selectView, flash],
  );

  async function commitRename() {
    const name = renameDraft.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!project || !name || name === project.name) return;
    const previous = project.name;
    begin();
    setProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, name } : p)).sort(byName));
    mapCache((list) => list.map((t) => (t.project_id === project.id ? { ...t, project_name: name } : t)));
    try {
      await http.renameProject(project.id, name);
    } catch (e) {
      setProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, name: previous } : p)).sort(byName));
      mapCache((list) => list.map((t) => (t.project_id === project.id ? { ...t, project_name: previous } : t)));
      flash(`Couldn't rename the project. ${message(e)}`);
    } finally {
      end();
    }
  }

  async function deleteCurrentProject() {
    if (!project) return;
    const doomed = project;
    setConfirmDeleteProject(false);
    begin();
    try {
      await http.deleteProject(doomed.id);
      setProjects((ps) => ps.filter((p) => p.id !== doomed.id));
      setCache((c) => {
        const { [doomed.id]: _removed, ...rest } = c;
        return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.filter((t) => t.project_id !== doomed.id)]));
      });
      selectView("all");
    } catch (e) {
      flash(`Couldn't delete the project. ${message(e)}`);
    } finally {
      end();
    }
  }

  async function signOut() {
    try {
      await http.logout();
    } finally {
      window.location.assign("/login");
    }
  }

  // ------------------------------------------------------------------ derive

  const tasks = cache[view];
  const loadingView = tasks === undefined;
  const totalOpen = useMemo(() => projects.reduce((n, p) => n + p.open_count, 0), [projects]);
  const openCount = project ? project.open_count : totalOpen;
  const doneCount = project ? project.done_count : projects.reduce((n, p) => n + p.done_count, 0);

  const shownDone = (t: ListedTask) => settling[t.id] ?? t.completed;
  const split = (list: ListedTask[]) => ({
    open: list.filter((t) => !shownDone(t)).sort(byOrder),
    done: list.filter(shownDone).sort(byRecentlyDone),
  });

  useEffect(() => {
    document.title = `${openCount > 0 ? `(${openCount}) ` : ""}${project?.name ?? "All projects"} · TaskHub`;
  }, [openCount, project?.name]);

  const handlers = { onToggle: toggle, onTitle: editTitle, onNotes: editNotes, onDelete: removeOne };
  const rows = (list: ListedTask[]) =>
    list.length === 0 ? null : (
    <ul>
      {list.map((t) => (
        <TaskRow key={t.id} task={t} {...handlers} />
      ))}
    </ul>
    );

  const title = project?.name ?? "All projects";
  const sidebarProps = { projects, view, totalOpen, onSelect: selectView, onAddProject: addProject };

  // ------------------------------------------------------------------ render

  let body: React.ReactNode;
  if (projects.length === 0) {
    body = (
      <p className="mt-10 max-w-md text-ink2">
        No projects yet. Add one from the sidebar, or run <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-sm">taskhub init</code> inside a
        project folder.
      </p>
    );
  } else if (loadingView) {
    body = (
      <div aria-busy="true" aria-label="Loading tasks" className="mt-6 space-y-5">
        {[62, 80, 48].map((w) => (
          <div key={w} className="h-4 rounded bg-hover" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  } else if (project) {
    const { open, done } = split(tasks);
    const nothing = open.length === 0 && (hideDone || done.length === 0);
    body = (
      <>
        {rows(open)}
        {nothing && (
          <p className="py-8 text-ink3">{done.length > 0 ? "All clear. Everything here is done." : "Nothing here yet. Type above and press Enter."}</p>
        )}
        {!hideDone && done.length > 0 && (
          <section aria-label="Completed tasks" className="mt-8">
            <h2 className="pb-1 font-mono text-[11px] tracking-[0.08em] text-ink3 uppercase">Completed · {done.length}</h2>
            {rows(done)}
          </section>
        )}
      </>
    );
  } else {
    const groups = projects
      .map((p) => ({ p, ...split(tasks.filter((t) => t.project_id === p.id)) }))
      .filter((g) => g.open.length > 0 || (!hideDone && g.done.length > 0));
    body =
      groups.length === 0 ? (
        <p className="py-8 text-ink3">Nothing outstanding anywhere. Add a task above.</p>
      ) : (
        <div className="space-y-9 pt-6">
          {groups.map(({ p, open, done }) => (
            <section key={p.id} aria-label={p.name}>
              <h2 className="flex items-baseline justify-between pb-1">
                <button
                  type="button"
                  onClick={() => selectView(p.id)}
                  className="rounded-sm font-mono text-[11px] tracking-[0.08em] text-ink3 uppercase hover:text-ink"
                >
                  {p.name}
                </button>
                <span className="font-mono text-xs tabular-nums text-ink3">{p.open_count}</span>
              </h2>
              {rows(open)}
              {!hideDone && rows(done)}
            </section>
          ))}
        </div>
      );
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16.5rem_minmax(0,1fr)]">
      <Sidebar {...sidebarProps} onSignOut={signOut} />

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-bg md:hidden">
          <div className="flex h-14 items-center justify-between px-5">
            <Wordmark />
            <button
              type="button"
              aria-expanded={navOpen}
              aria-controls="mobile-nav"
              onClick={() => setNavOpen((o) => !o)}
              className="flex h-11 max-w-[60%] items-center gap-2 rounded-md px-3 text-[15px] text-ink2 hover:bg-hover"
            >
              <span className="truncate">{title}</span>
              <ChevronIcon open={navOpen} />
            </button>
          </div>
          {navOpen && (
            <div id="mobile-nav" className="max-h-[70dvh] overflow-y-auto border-t border-line bg-side px-3 py-4">
              <ProjectNav {...sidebarProps} />
              <button type="button" onClick={signOut} className="mt-4 min-h-11 w-full rounded-md px-3 text-left text-sm text-ink3 hover:bg-hover">
                Sign out
              </button>
            </div>
          )}
        </header>

        <main className="px-5 pt-7 pb-28 md:px-14 md:pt-14">
          <div className="max-w-[44rem]">
            <div className="flex items-baseline justify-between gap-4">
              {renaming && project ? (
                <input
                  autoFocus
                  value={renameDraft}
                  maxLength={120}
                  aria-label="Project name"
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="min-w-0 flex-1 border-b border-accent bg-transparent text-[2rem] leading-[1.1] font-semibold tracking-tight outline-none md:text-[2.5rem]"
                />
              ) : (
                <h1 className="min-w-0 text-[2rem] leading-[1.1] font-semibold tracking-tight break-words md:text-[2.5rem]">{title}</h1>
              )}
              <p className="shrink-0 font-mono text-sm tabular-nums text-ink2" aria-live="polite">
                <span className="font-medium text-ink">{openCount}</span> open
              </p>
            </div>

            <div className="mt-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink3">
              {project?.repo_url && <span className="max-w-full truncate font-mono text-xs">{project.repo_url}</span>}
              {doneCount > 0 && <span>{doneCount} completed</span>}
              <span className="ml-auto flex items-center gap-4">
                {project &&
                  (confirmDeleteProject ? (
                    <span role="alertdialog" aria-label="Confirm project deletion" className="flex items-center gap-2">
                      <span className="text-ink2">
                        Delete with {project.open_count + project.done_count} task{project.open_count + project.done_count === 1 ? "" : "s"}?
                      </span>
                      <button type="button" onClick={deleteCurrentProject} className="min-h-9 rounded-md px-2 font-medium text-danger hover:bg-danger/10">
                        Delete
                      </button>
                      <button type="button" autoFocus onClick={() => setConfirmDeleteProject(false)} className="min-h-9 rounded-md px-2 hover:bg-hover">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameDraft(project.name);
                          setRenaming(true);
                        }}
                        className="min-h-9 rounded-md px-1 hover:text-ink"
                      >
                        Rename
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteProject(true)} className="min-h-9 rounded-md px-1 hover:text-danger">
                        Delete
                      </button>
                    </>
                  ))}
                <button
                  type="button"
                  role="switch"
                  aria-checked={hideDone}
                  onClick={toggleHideDone}
                  className="flex min-h-9 items-center gap-2 rounded-md px-1 hover:text-ink"
                >
                  <span
                    aria-hidden
                    className={`relative h-4 w-7 rounded-full border transition-colors ${hideDone ? "border-accent bg-accent" : "border-line2 bg-transparent"}`}
                  >
                    <span
                      className={`absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-all ${
                        hideDone ? "left-[14px] bg-accent-ink" : "left-[3px] bg-ink3"
                      }`}
                    />
                  </span>
                  Hide completed
                </button>
              </span>
            </div>

            {projects.length > 0 && (
              <AddTask
                key={project?.id ?? "all"}
                projects={projects}
                projectId={project?.id ?? null}
                defaultProjectId={project?.id ?? projects[0]!.id}
                onAdd={addTask}
              />
            )}

            <div className="mt-1">{body}</div>
          </div>
        </main>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`fixed right-4 bottom-4 left-4 z-30 flex items-start justify-between gap-4 rounded-md border px-4 py-3 text-sm shadow-sm md:right-auto md:left-[18.5rem] md:max-w-md ${
            notice.kind === "error" ? "border-danger/40 bg-surface text-danger" : "border-line2 bg-surface text-ink2"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="-m-1 p-1 text-ink3 hover:text-ink">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers/app";
import { TEST_PASSWORD } from "./global-setup";

beforeEach(resetDb);

const mkProject = async (name = "Alpha", extra: object = {}) =>
  (await api("POST", "/api/projects", { body: { name, ...extra } })).body.project;

describe("authorization", () => {
  it("rejects missing and wrong credentials on every resource", async () => {
    for (const [m, p] of [
      ["GET", "/api/projects"],
      ["POST", "/api/projects"],
      ["GET", "/api/tasks"],
      ["POST", "/api/tasks"],
      ["GET", "/api/health"],
    ] as const) {
      expect((await api(m, p, { token: null })).status).toBe(401);
      expect((await api(m, p, { token: "wrong" })).status).toBe(401);
    }
  });
  it("health works with a token", async () => {
    const r = await api("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, database: true });
  });
  it("never caches or leaks internals", async () => {
    const r = await api("GET", "/api/projects/not-a-uuid");
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|postgres|SELECT/i);
  });
});

describe("login", () => {
  const login = (password: unknown, ip = "9.9.9.9") =>
    api("POST", "/api/auth/login", { token: null, body: { password }, headers: { "x-forwarded-for": ip } });

  it("sets a hardened cookie on success", async () => {
    const r = await login(TEST_PASSWORD);
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^taskhub_session=\d+\./);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
  it("rejects a wrong password", async () => {
    const r = await login("nope");
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("locks an IP out after repeated failures, but not other IPs", async () => {
    for (let i = 0; i < 8; i++) expect((await login("bad", "1.1.1.1")).status).toBe(401);
    expect((await login(TEST_PASSWORD, "1.1.1.1")).status).toBe(429);
    expect((await login(TEST_PASSWORD, "2.2.2.2")).status).toBe(200);
  });
  it("concurrent guesses cannot exceed the attempt cap", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => login("wrong", "7.7.7.7")));
    const reachedPasswordCheck = results.filter((r) => r.status === 401).length;
    expect(reachedPasswordCheck).toBeLessThanOrEqual(8);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(22);
    // and the right password is locked out too, until the window passes
    expect((await login(TEST_PASSWORD, "7.7.7.7")).status).toBe(429);
  });
  it("logout cannot be forced cross-site", async () => {
    const cookie = (await login(TEST_PASSWORD)).headers.get("set-cookie")!.split(";")[0]!;
    const cross = await api("POST", "/api/auth/logout", { token: null, headers: { cookie, origin: "https://evil.example", host: "taskhub.test" } });
    expect(cross.status).toBe(403);
    expect(cross.headers.get("set-cookie")).toBeNull();
    const same = await api("POST", "/api/auth/logout", { token: null, headers: { cookie, origin: "http://taskhub.test", host: "taskhub.test" } });
    expect(same.status).toBe(200);
    expect(same.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
  it("a cookie from login authenticates reads", async () => {
    const cookie = (await login(TEST_PASSWORD)).headers.get("set-cookie")!.split(";")[0]!;
    const r = await api("GET", "/api/projects", { token: null, headers: { cookie } });
    expect(r.status).toBe(200);
  });
});

describe("projects", () => {
  it("creates, lists with counts, finds, renames and deletes", async () => {
    const p = await mkProject("Alpha", { repo_url: "git@github.com:Acme/Alpha.git", local_key: "C:\\code\\alpha" });
    expect(p.repo_url).toBe("github.com/acme/alpha");
    expect(p.local_key).toBe("c:/code/alpha");

    await api("POST", "/api/tasks", { body: { project_id: p.id, title: "one" } });
    const done = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "two" } })).body.task;
    await api("POST", `/api/tasks/${done.id}/complete`);

    const list = (await api("GET", "/api/projects")).body.projects;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Alpha", open_count: 1, done_count: 1 });

    const byRepo = await api("GET", `/api/projects/find?repo_url=${encodeURIComponent("https://github.com/ACME/alpha")}`);
    expect(byRepo.body).toMatchObject({ matched_by: "repo_url", project: { id: p.id } });
    const byDir = await api("GET", `/api/projects/find?local_key=${encodeURIComponent("/mnt/c/code/alpha")}`);
    expect(byDir.body).toMatchObject({ matched_by: "local_key", project: { id: p.id } });
    expect((await api("GET", "/api/projects/find?repo_url=github.com/nobody/nothing")).status).toBe(404);
    expect((await api("GET", "/api/projects/find")).status).toBe(400);

    const renamed = await api("PATCH", `/api/projects/${p.id}`, { body: { name: "Alpha 2" } });
    expect(renamed.body.project.name).toBe("Alpha 2");
    expect(renamed.body.project.repo_url).toBe("github.com/acme/alpha");

    expect((await api("DELETE", `/api/projects/${p.id}`)).status).toBe(200);
    expect((await api("GET", `/api/projects/${p.id}`)).status).toBe(404);
    expect((await api("GET", "/api/tasks?status=all")).body.tasks).toHaveLength(0); // cascade
  });

  it("refuses duplicate names (case-insensitive), repo urls and directories", async () => {
    await mkProject("Alpha", { repo_url: "github.com/a/b", local_key: "/x/y" });
    expect((await api("POST", "/api/projects", { body: { name: "  alpha " } })).status).toBe(409);
    const repo = await api("POST", "/api/projects", { body: { name: "Other", repo_url: "https://github.com/A/B.git" } });
    expect(repo.status).toBe(409);
    expect(repo.body.error.code).toBe("repo_url_in_use");
    const dir = await api("POST", "/api/projects", { body: { name: "Other", local_key: "/x/y/" } });
    expect(dir.body.error.code).toBe("local_key_in_use");
  });

  it("validates input", async () => {
    expect((await api("POST", "/api/projects", { body: {} })).status).toBe(400);
    expect((await api("POST", "/api/projects", { body: { name: "" } })).status).toBe(400);
    expect((await api("POST", "/api/projects", { body: { name: "x".repeat(121) } })).status).toBe(400);
    expect((await api("POST", "/api/projects", { body: { name: "x", nme: 1 } })).status).toBe(400);
    expect((await api("POST", "/api/projects", { body: [] })).status).toBe(400);
  });
});

describe("POST /api/projects/ensure", () => {
  const ensure = (body: object) => api("POST", "/api/projects/ensure", { body });

  it("creates once, then returns the same project", async () => {
    const a = await ensure({ repo_url: "git@github.com:acme/shop.git", local_key: "C:\\code\\shop" });
    expect(a.status).toBe(201);
    expect(a.body.created).toBe(true);
    expect(a.body.project.name).toBe("shop");

    const b = await ensure({ repo_url: "https://github.com/ACME/shop", local_key: "/mnt/c/code/shop" });
    expect(b.status).toBe(200);
    expect(b.body.created).toBe(false);
    expect(b.body.project.id).toBe(a.body.project.id);
    expect((await api("GET", "/api/projects")).body.projects).toHaveLength(1);
  });

  it("is race-safe: 12 simultaneous agent starts create exactly one project", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => ensure({ repo_url: "github.com/acme/race", local_key: "/code/race" })),
    );
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.body.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.project.id)).size).toBe(1);
    expect((await api("GET", "/api/projects")).body.projects).toHaveLength(1);
  });

  it("learns the repo url for a project first registered by directory", async () => {
    const a = await ensure({ name: "Site", local_key: "/code/site" });
    const b = await ensure({ repo_url: "github.com/acme/site", local_key: "/code/site" });
    expect(b.body.project.id).toBe(a.body.project.id);
    expect(b.body.project.repo_url).toBe("github.com/acme/site");
  });

  it("adopts a hand-made project of the same name", async () => {
    const manual = await mkProject("Billing");
    const r = await ensure({ name: "billing", repo_url: "github.com/acme/billing", local_key: "/code/billing" });
    expect(r.body.created).toBe(false);
    expect(r.body.matched_by).toBe("name");
    expect(r.body.project.id).toBe(manual.id);
    expect(r.body.project.repo_url).toBe("github.com/acme/billing");
  });

  it("does not merge two different projects that share a name", async () => {
    await ensure({ name: "app", local_key: "/code/one/app" });
    const r = await ensure({ name: "app", local_key: "/code/two/app" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("name_in_use");
    const ok = await ensure({ name: "app two", local_key: "/code/two/app" });
    expect(ok.status).toBe(201);
  });

  it("needs something to go on", async () => {
    expect((await ensure({})).status).toBe(400);
  });

  it("never files a different repository's work under a reused folder", async () => {
    const a = await ensure({ repo_url: "github.com/acme/old", local_key: "/code/current" });
    // find() must not hand repo B the project that belongs to repo A just because the folder matches
    const miss = await api("GET", `/api/projects/find?repo_url=${encodeURIComponent("github.com/acme/new")}&local_key=${encodeURIComponent("/code/current")}`);
    expect(miss.status).toBe(404);

    const b = await ensure({ repo_url: "github.com/acme/new", local_key: "/code/current" });
    expect(b.status).toBe(201);
    expect(b.body.project.id).not.toBe(a.body.project.id);
    expect(b.body.project.local_key).toBe("/code/current");

    const oldStill = await api("GET", `/api/projects/find?repo_url=github.com/acme/old`);
    expect(oldStill.body.project.id).toBe(a.body.project.id);
    expect(oldStill.body.project.local_key).toBeNull(); // released, identity kept via repo_url

    // a folder with no remote still resolves by directory
    const plain = await ensure({ name: "scratch", local_key: "/code/scratch" });
    const again = await api("GET", `/api/projects/find?local_key=${encodeURIComponent("/code/scratch")}`);
    expect(again.body.project.id).toBe(plain.body.project.id);
  });

  it("distinguishes Linux folders that differ only by case", async () => {
    const a = await ensure({ name: "App upper", local_key: "/home/me/App" });
    const b = await ensure({ name: "App lower", local_key: "/home/me/app" });
    expect(a.body.project.id).not.toBe(b.body.project.id);
  });

  it("rejects over-long identities with 400 (not a database 500) and clips derived names", async () => {
    const longRepo = "github.com/acme/" + "x".repeat(290);
    expect((await ensure({ repo_url: longRepo })).status).toBe(400);
    expect((await ensure({ local_key: "/" + "d".repeat(600) })).status).toBe(400);
    const longDir = "/code/" + "n".repeat(200);
    const r = await ensure({ local_key: longDir });
    expect(r.status).toBe(201);
    expect(r.body.project.name.length).toBeLessThanOrEqual(120);
  });
});

describe("tasks", () => {
  it("creates, lists in order, edits, completes, reopens and deletes", async () => {
    const p = await mkProject();
    const t1 = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "  First   task " } })).body.task;
    expect(t1.title).toBe("First task");
    expect(t1.completed).toBe(false);
    expect(t1.completed_at).toBeNull();
    const t2 = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "Second", notes: "details" } })).body.task;
    expect(t2.notes).toBe("details");

    const open = (await api("GET", `/api/tasks?project_id=${p.id}`)).body.tasks;
    expect(open.map((t: any) => t.title)).toEqual(["First task", "Second"]);
    expect(open[0].project_name).toBe("Alpha");

    const edited = await api("PATCH", `/api/tasks/${t1.id}`, { body: { title: "First, renamed", notes: "n" } });
    expect(edited.body.task).toMatchObject({ title: "First, renamed", notes: "n", completed: false });

    const done = await api("POST", `/api/tasks/${t1.id}/complete`);
    expect(done.body.task.completed).toBe(true);
    expect(done.body.task.completed_at).toBeTruthy();
    const stamp = done.body.task.completed_at;
    // Idempotent: completing again keeps the original completion time.
    expect((await api("POST", `/api/tasks/${t1.id}/complete`)).body.task.completed_at).toBe(stamp);

    expect((await api("GET", `/api/tasks?project_id=${p.id}`)).body.tasks).toHaveLength(1);
    expect((await api("GET", `/api/tasks?project_id=${p.id}&status=done`)).body.tasks).toHaveLength(1);
    const all = (await api("GET", `/api/tasks?project_id=${p.id}&status=all`)).body.tasks;
    expect(all.map((t: any) => t.title)).toEqual(["Second", "First, renamed"]); // open first, done after

    const reopened = await api("POST", `/api/tasks/${t1.id}/reopen`);
    expect(reopened.body.task).toMatchObject({ completed: false, completed_at: null });

    expect((await api("DELETE", `/api/tasks/${t1.id}`)).status).toBe(200);
    expect((await api("DELETE", `/api/tasks/${t1.id}`)).status).toBe(404);
    expect((await api("GET", `/api/tasks/${t1.id}`)).status).toBe(404);
  });

  it("clears notes with null and honours explicit position", async () => {
    const p = await mkProject();
    const a = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "A", notes: "x" } })).body.task;
    const b = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "B" } })).body.task;
    expect((await api("PATCH", `/api/tasks/${a.id}`, { body: { notes: null } })).body.task.notes).toBeNull();
    await api("PATCH", `/api/tasks/${b.id}`, { body: { position: -1 } });
    const order = (await api("GET", `/api/tasks?project_id=${p.id}`)).body.tasks.map((t: any) => t.title);
    expect(order).toEqual(["B", "A"]);
  });

  it("returns the existing open task instead of creating a duplicate", async () => {
    const p = await mkProject();
    const first = await api("POST", "/api/tasks", { body: { project_id: p.id, title: "Finish product import" } });
    expect(first.status).toBe(201);
    const again = await api("POST", "/api/tasks", { body: { project_id: p.id, title: "  finish PRODUCT   import " } });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.task.id).toBe(first.body.task.id);

    // After completion the same title may be added again.
    await api("POST", `/api/tasks/${first.body.task.id}/complete`);
    const third = await api("POST", "/api/tasks", { body: { project_id: p.id, title: "Finish product import" } });
    expect(third.status).toBe(201);
    // ...but then the old one cannot be reopened beside it.
    const reopen = await api("POST", `/api/tasks/${first.body.task.id}/reopen`);
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.code).toBe("duplicate_task");
  });

  it("allows the same title in different projects", async () => {
    const a = await mkProject("A");
    const b = await mkProject("B");
    expect((await api("POST", "/api/tasks", { body: { project_id: a.id, title: "Ship" } })).status).toBe(201);
    expect((await api("POST", "/api/tasks", { body: { project_id: b.id, title: "Ship" } })).status).toBe(201);
  });

  it("is race-safe: simultaneous identical adds create one task", async () => {
    const p = await mkProject();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => api("POST", "/api/tasks", { body: { project_id: p.id, title: "Same thing" } })),
    );
    expect(rs.filter((r) => r.body.created)).toHaveLength(1);
    expect((await api("GET", `/api/tasks?project_id=${p.id}`)).body.tasks).toHaveLength(1);
  });

  it("concurrent updates to different tasks and fields do not overwrite each other", async () => {
    const p = await mkProject();
    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push((await api("POST", "/api/tasks", { body: { project_id: p.id, title: `Task ${i}` } })).body.task.id);
    }
    await Promise.all([
      api("POST", `/api/tasks/${ids[0]}/complete`),
      api("PATCH", `/api/tasks/${ids[1]}`, { body: { title: "Renamed" } }),
      api("PATCH", `/api/tasks/${ids[2]}`, { body: { notes: "noted" } }),
      api("DELETE", `/api/tasks/${ids[3]}`),
      // two agents touching DIFFERENT fields of the SAME task
      api("PATCH", `/api/tasks/${ids[4]}`, { body: { title: "Task 4 renamed" } }),
      api("PATCH", `/api/tasks/${ids[4]}`, { body: { notes: "added by another agent" } }),
      api("POST", `/api/tasks/${ids[5]}/complete`),
    ]);
    const byId = Object.fromEntries(
      (await api("GET", `/api/tasks?project_id=${p.id}&status=all`)).body.tasks.map((t: any) => [t.id, t]),
    );
    expect(byId[ids[0]].completed).toBe(true);
    expect(byId[ids[1]].title).toBe("Renamed");
    expect(byId[ids[2]].notes).toBe("noted");
    expect(byId[ids[3]]).toBeUndefined();
    expect(byId[ids[4]]).toMatchObject({ title: "Task 4 renamed", notes: "added by another agent" });
    expect(byId[ids[5]].completed).toBe(true);
  });

  it("resolves unique id prefixes like the CLI prints", async () => {
    const p = await mkProject();
    const t = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "Prefix me" } })).body.task;
    const short = t.id.slice(0, 8);
    expect((await api("GET", `/api/tasks/${short}`)).body.task.id).toBe(t.id);
    expect((await api("POST", `/api/tasks/${short}/complete`)).body.task.completed).toBe(true);
    // longer prefixes may include the hyphen, and extending an ambiguous prefix works
    expect((await api("GET", `/api/tasks/${t.id.slice(0, 13)}`)).body.task.id).toBe(t.id); // 8 + "-" + 4
    expect((await api("GET", `/api/tasks/${t.id.replace(/-/g, "").slice(0, 12)}`)).body.task.id).toBe(t.id);
    expect((await api("GET", "/api/tasks/abc")).status).toBe(400);
    expect((await api("GET", "/api/tasks/ffffffff")).status).toBe(404);
  });

  it("validates input", async () => {
    const p = await mkProject();
    const bad = async (body: object) => (await api("POST", "/api/tasks", { body })).status;
    expect(await bad({ title: "x" })).toBe(400); // no project
    expect(await bad({ project_id: "nope", title: "x" })).toBe(400);
    expect(await bad({ project_id: p.id })).toBe(400);
    expect(await bad({ project_id: p.id, title: "   " })).toBe(400);
    expect(await bad({ project_id: p.id, title: "x".repeat(301) })).toBe(400);
    expect(await bad({ project_id: p.id, title: "x", completed: true })).toBe(400);
    expect(await bad({ project_id: "11111111-1111-4111-8111-111111111111", title: "x" })).toBe(404);

    const t = (await api("POST", "/api/tasks", { body: { project_id: p.id, title: "ok" } })).body.task;
    const patch = async (body: object) => (await api("PATCH", `/api/tasks/${t.id}`, { body })).status;
    expect(await patch({})).toBe(400);
    expect(await patch({ title: "" })).toBe(400);
    expect(await patch({ completed: "yes" })).toBe(400);
    expect(await patch({ position: "top" })).toBe(400);
    expect(await patch({ wat: 1 })).toBe(400);
    expect((await api("GET", "/api/tasks?status=bogus")).status).toBe(400);
    expect((await api("GET", "/api/tasks?limit=0")).status).toBe(400);
  });

  it("lists across all projects with project names", async () => {
    const a = await mkProject("A");
    const b = await mkProject("B");
    await api("POST", "/api/tasks", { body: { project_id: a.id, title: "a1" } });
    await api("POST", "/api/tasks", { body: { project_id: b.id, title: "b1" } });
    const all = (await api("GET", "/api/tasks")).body.tasks;
    expect(all.map((t: any) => `${t.project_name}:${t.title}`).sort()).toEqual(["A:a1", "B:b1"]);
  });
});

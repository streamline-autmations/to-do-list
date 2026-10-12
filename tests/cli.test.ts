import { execFile } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHttpServer, resetDb } from "./helpers/app";
import { TEST_TOKEN } from "./global-setup";

const CLI = resolve(__dirname, "../cli/taskhub.mjs");
let url = "";
let server: Server;
let sandbox = "";
let home = "";

interface Run {
  code: number;
  out: string;
  err: string;
}

function run(args: string[], opts: { cwd?: string; env?: Record<string, string>; input?: string } = {}): Promise<Run> {
  return new Promise((res) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      {
        cwd: opts.cwd ?? sandbox,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          TASKHUB_URL: url,
          TASKHUB_TOKEN: TEST_TOKEN,
          ...opts.env,
        } as unknown as NodeJS.ProcessEnv,
        timeout: 30_000,
      },
      (error, stdout, stderr) =>
        res({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out: stdout, err: stderr }),
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}

function repo(name: string, remote?: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return realpathSync(dir);
}

beforeAll(async () => {
  ({ url, server } = await startHttpServer());
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "taskhub-cli-")));
  home = join(sandbox, "home");
  mkdirSync(home);
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(sandbox, { recursive: true, force: true });
});
beforeEach(resetDb);

describe("configuration and sync failures", () => {
  it("explains how to log in when unconfigured", async () => {
    const r = await run(["list"], { env: { TASKHUB_URL: "", TASKHUB_TOKEN: "" } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not configured/);
    expect(r.err).toMatch(/taskhub login/);
  });

  it("reports an unreachable server as a failed sync, never as success", async () => {
    const dir = repo("offline", "git@github.com:acme/offline.git");
    const r = await run(["add", "Will not be saved"], { cwd: dir, env: { TASKHUB_URL: "http://127.0.0.1:9" } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/sync FAILED/);
    expect(r.err).toMatch(/Nothing was saved/);
    expect(r.out).not.toMatch(/Added/);
  });

  it("reports a bad token clearly", async () => {
    const dir = repo("badtoken", "git@github.com:acme/badtoken.git");
    const r = await run(["list"], { cwd: dir, env: { TASKHUB_TOKEN: "wrong" } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/token is missing or wrong/);
  });

  it("login verifies, then saves a private config that later commands use", async () => {
    const bad = await run(["login", "--url", url, "--token", "nope"], { env: { TASKHUB_URL: "", TASKHUB_TOKEN: "" } });
    expect(bad.code).toBe(1);
    expect(existsSync(join(home, ".taskhub", "config.json"))).toBe(false);

    const ok = await run(["login", "--url", url, "--token-stdin"], {
      env: { TASKHUB_URL: "", TASKHUB_TOKEN: "" },
      input: TEST_TOKEN + "\n",
    });
    expect(ok.code).toBe(0);
    const saved = JSON.parse(readFileSync(join(home, ".taskhub", "config.json"), "utf8"));
    expect(saved).toEqual({ url, token: TEST_TOKEN });

    const dir = repo("viaconfig", "git@github.com:acme/viaconfig.git");
    const r = await run(["init"], { cwd: dir, env: { TASKHUB_URL: "", TASKHUB_TOKEN: "" } });
    expect(r.code).toBe(0);
  });

  it("refuses to send a token over plain http to a remote host, from login AND from env vars", async () => {
    const login = await run(["login", "--url", "http://example.com", "--token", "x"], { env: { TASKHUB_URL: "", TASKHUB_TOKEN: "" } });
    expect(login.code).toBe(1);
    expect(login.err).toMatch(/must be https/);

    const viaEnv = await run(["projects"], { env: { TASKHUB_URL: "http://public.example", TASKHUB_TOKEN: TEST_TOKEN } });
    expect(viaEnv.code).toBe(1);
    expect(viaEnv.err).toMatch(/Refusing to send the API token/);
    expect(viaEnv.err).not.toContain(TEST_TOKEN);

    const trick = await run(["projects"], { env: { TASKHUB_URL: "http://localhost@evil.example", TASKHUB_TOKEN: TEST_TOKEN } });
    expect(trick.code).toBe(1);
    expect(trick.err).toMatch(/Refusing/);
  });
});

describe("project identity", () => {
  it("init registers once; clones with different URL styles share the project", async () => {
    const a = repo("shop-a", "git@github.com:Acme/Shop.git");
    const b = repo("shop-b", "https://github.com/acme/shop");

    const first = await run(["init"], { cwd: a });
    expect(first.out).toMatch(/Registered new project "shop"/);
    const second = await run(["init"], { cwd: a });
    expect(second.out).toMatch(/Already registered: "shop"/);
    const clone = await run(["init"], { cwd: b });
    expect(clone.out).toMatch(/Already registered: "shop"/);

    const list = JSON.parse((await run(["projects", "--json"], { cwd: a })).out);
    expect(list.projects).toHaveLength(1);
    expect(list.current).toBe(list.projects[0].id);
  });

  it("is race-safe: six agents starting at once create one project", async () => {
    const dir = repo("race", "git@github.com:acme/race.git");
    const runs = await Promise.all(Array.from({ length: 6 }, () => run(["init", "--json"], { cwd: dir })));
    expect(runs.every((r) => r.code === 0)).toBe(true);
    expect(new Set(runs.map((r) => JSON.parse(r.out).project.id)).size).toBe(1);
    expect(runs.filter((r) => JSON.parse(r.out).created)).toHaveLength(1);
  });

  it("falls back to the directory when there is no git repository", async () => {
    const dir = join(sandbox, "plain-notes");
    mkdirSync(dir);
    const added = await run(["add", "Write intro"], { cwd: dir });
    expect(added.out).toMatch(/Registered new project "plain-notes"/);
    const again = await run(["add", "Second"], { cwd: dir });
    expect(again.out).not.toMatch(/Registered/);
    expect(JSON.parse((await run(["projects", "--json"], { cwd: dir })).out).projects).toHaveLength(1);
  });

  it("will not register the home directory as a project", async () => {
    const r = await run(["add", "Oops"], { cwd: home });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not a project folder/);
    expect(JSON.parse((await run(["projects", "--json"], { cwd: home })).out).projects).toHaveLength(0);
  });

  it("reading never registers anything", async () => {
    const dir = repo("readonly", "git@github.com:acme/readonly.git");
    const r = await run(["list"], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not registered/);
    expect(JSON.parse((await run(["projects", "--json"], { cwd: dir })).out).projects).toHaveLength(0);
  });
});

describe("task workflow", () => {
  it("add / list / done / reopen / edit / delete", async () => {
    const dir = repo("flow", "git@github.com:acme/flow.git");

    const add = await run(["add", "Finish product import", "--notes", "Use the CSV from Drive"], { cwd: dir });
    expect(add.code).toBe(0);
    expect(add.out).toMatch(/Registered new project "flow"/);
    expect(add.out).toMatch(/Added [0-9a-f]{8}  Finish product import/);

    // unquoted words work too, and exact duplicates are not created
    const dup = await run(["add", "finish", "product", "import"], { cwd: dir });
    expect(dup.out).toMatch(/Already open/);
    expect(dup.out).toMatch(/not duplicated/);

    await run(["add", "Fix invoice rounding"], { cwd: dir });

    const list = await run(["list"], { cwd: dir });
    expect(list.out).toMatch(/flow - 2 open/);
    expect(list.out).toMatch(/\[ \] [0-9a-f]{8}  Finish product import/);
    expect(list.out).toMatch(/note: Use the CSV from Drive/);

    const { tasks } = JSON.parse((await run(["list", "--json"], { cwd: dir })).out);
    expect(tasks).toHaveLength(2);
    const prefix = tasks[0].id.slice(0, 8);

    const done = await run(["done", prefix], { cwd: dir });
    expect(done.out).toMatch(/Completed/);
    expect((await run(["list"], { cwd: dir })).out).toMatch(/flow - 1 open/);
    const doneList = (await run(["list", "--done"], { cwd: dir })).out;
    expect(doneList).toMatch(/flow - 1 completed/); // not a misleading "0 open"
    expect(doneList).toMatch(/\[x\]/);
    expect((await run(["list", "--all"], { cwd: dir })).out).toMatch(/\[x\][\s\S]*|\[ \]/);

    expect((await run(["reopen", prefix], { cwd: dir })).out).toMatch(/Reopened/);
    expect((await run(["edit", prefix, "Finish the product import", "--notes", "updated"], { cwd: dir })).out).toMatch(/Updated/);
    expect((await run(["list"], { cwd: dir })).out).toMatch(/Finish the product import/);

    const noConfirm = await run(["delete", prefix], { cwd: dir });
    expect(noConfirm.code).toBe(2);
    expect((await run(["delete", prefix, "--yes"], { cwd: dir })).code).toBe(0);
    expect((await run(["list"], { cwd: dir })).out).toMatch(/flow - 1 open/);
  });

  it("works across projects with --project and --all-projects", async () => {
    const a = repo("proj-a", "git@github.com:acme/proj-a.git");
    const b = repo("proj-b", "git@github.com:acme/proj-b.git");
    await run(["add", "A task"], { cwd: a });
    await run(["add", "B task"], { cwd: b });

    const viaFlag = await run(["add", "From afar", "--project", "proj-a"], { cwd: b });
    expect(viaFlag.out).toMatch(/\(proj-a\)/);
    const unknown = await run(["add", "x", "--project", "nope"], { cwd: b });
    expect(unknown.code).toBe(1);

    const everything = await run(["list", "--all-projects"], { cwd: b });
    expect(everything.out).toMatch(/proj-a[\s\S]*A task[\s\S]*From afar[\s\S]*proj-b[\s\S]*B task/);
    expect((await run(["list", "-g"], { cwd: b })).out).toMatch(/proj-a/);
  });

  it("done keeps going after a bad id and still exits non-zero", async () => {
    const dir = repo("multi", "git@github.com:acme/multi.git");
    await run(["add", "One"], { cwd: dir });
    const { tasks } = JSON.parse((await run(["list", "--json"], { cwd: dir })).out);
    const r = await run(["done", "deadbeef", tasks[0].id.slice(0, 8)], { cwd: dir });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Completed/);
    expect(r.err).toMatch(/deadbeef/);
  });

  it("status describes the connection and the project", async () => {
    const dir = repo("stat", "git@github.com:acme/stat.git");
    const before = await run(["status"], { cwd: dir });
    expect(before.code).toBe(0);
    expect(before.out).toMatch(/Connection : OK/);
    expect(before.out).toMatch(/not registered/);
    await run(["add", "Something"], { cwd: dir });
    const after = await run(["status"], { cwd: dir });
    expect(after.out).toMatch(/Project\s+: stat \([0-9a-f]{8}\) - 1 open/);
    expect(after.out).not.toContain(TEST_TOKEN);

    const down = await run(["status"], { cwd: dir, env: { TASKHUB_URL: "http://127.0.0.1:9" } });
    expect(down.code).toBe(1);
    expect(down.out).toMatch(/FAILED/);
  });

  it("usage errors exit with code 2", async () => {
    expect((await run(["bogus"])).code).toBe(2);
    expect((await run(["add"])).code).toBe(2);
    expect((await run(["help"])).out).toMatch(/Usage: taskhub/);
  });
});

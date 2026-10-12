#!/usr/bin/env node
// taskhub - command-line client for TaskHub. Zero dependencies, Node 18+.
// There is no local task store: every command talks to the shared TaskHub API.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const CONFIG_DIR = join(homedir(), ".taskhub");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ------------------------------------------------------------------ errors

class CliError extends Error {
  constructor(message, { code = 1, hint } = {}) {
    super(message);
    this.exitCode = code;
    this.hint = hint;
  }
}
const usage = (message) => new CliError(message, { code: 2, hint: "Run `taskhub help` for usage." });

// ------------------------------------------------------------------ config

function readConfig() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* no config yet */
  }
  const url = (process.env.TASKHUB_URL || file.url || "").replace(/\/+$/, "");
  const token = process.env.TASKHUB_TOKEN || file.token || "";
  return { url, token, fromEnv: Boolean(process.env.TASKHUB_URL || process.env.TASKHUB_TOKEN) };
}

function saveConfig({ url, token }) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify({ url, token }, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600); // no-op on Windows; the profile folder is already per-user
  } catch {
    /* ignore */
  }
}

/** The bearer token only ever travels over https (plain http is allowed for loopback testing). */
function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw usage(`'${raw}' is not a valid URL. Use the https:// address of your TaskHub deployment.`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol === "https:" || (u.protocol === "http:" && loopback)) return;
  throw new CliError(`Refusing to send the API token to ${u.origin}: it must be https:// (http:// is only allowed for localhost).`, {
    hint: "Fix TASKHUB_URL, or run `taskhub login`.",
  });
}

function requireConfig() {
  const cfg = readConfig();
  if (!cfg.url || !cfg.token) {
    throw new CliError("TaskHub is not configured on this machine.", {
      hint: "Run `taskhub login`, or set TASKHUB_URL and TASKHUB_TOKEN.",
    });
  }
  assertSafeUrl(cfg.url);
  return cfg;
}

// --------------------------------------------------------------------- API

async function request(method, path, body) {
  const cfg = requireConfig();
  let res;
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? "timed out" : err?.cause?.code || err?.cause?.message || err.message;
    throw new CliError(`TaskHub sync FAILED: could not reach ${cfg.url} (${reason}). Nothing was saved.`);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new CliError(`TaskHub sync FAILED: ${msg}. The token is missing or wrong.`, { hint: "Run `taskhub login`." });
    }
    const err = new CliError(`TaskHub sync FAILED: ${msg}`);
    err.status = res.status;
    err.apiCode = data?.error?.code;
    throw err;
  }
  return data;
}

const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  patch: (p, b) => request("PATCH", p, b),
  del: (p) => request("DELETE", p),
};

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const valueFlags = new Set(["name", "notes", "project", "status", "url", "token", "title"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).toLowerCase();
      if (eq !== -1) flags[key] = a.slice(eq + 1);
      else if (valueFlags.has(key)) {
        if (i + 1 >= argv.length) throw usage(`--${key} needs a value`);
        flags[key] = argv[++i];
      } else flags[key] = true;
    } else if (a === "-p") {
      flags.project = argv[++i];
    } else if (a === "-y") {
      flags.yes = true;
    } else if (a === "-g") {
      flags["all-projects"] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

// -------------------------------------------------------- project identity

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

/** Who is the current directory? Git repository first, plain directory otherwise. */
export function detectIdentity(cwd = process.cwd()) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  let remote = "";
  if (top) {
    remote = git(["remote", "get-url", "origin"], top);
    if (!remote) {
      const first = git(["remote"], top).split(/\r?\n/)[0];
      if (first) remote = git(["remote", "get-url", first], top);
    }
  }
  const dir = top || cwd;
  return { repo_url: remote || undefined, local_key: dir, dir, inGit: Boolean(top) };
}

function isUnsafeAutoRegister(identity) {
  if (identity.repo_url) return false;
  const norm = identity.dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const home = homedir().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm === "" || norm === home || /^[a-z]:$/.test(norm) || /^\/mnt\/[a-z]$/.test(norm) || norm === "/mnt/c/users";
}

async function resolveNamedProject(ref) {
  const { projects } = await api.get("/api/projects");
  const lower = ref.toLowerCase();
  const byId = projects.filter((p) => p.id === lower || (lower.length >= 6 && /^[0-9a-f-]+$/.test(lower) && p.id.startsWith(lower)));
  if (byId.length === 1) return byId[0];
  const byName = projects.filter((p) => p.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  throw new CliError(`No project named or numbered '${ref}'.`, {
    hint: "Run `taskhub projects` to see them, or `taskhub init --name \"" + ref + "\"` in its folder to register one.",
  });
}

/** Find (or, with create:true, register) the project for the current directory. */
async function currentProject(flags, { create = false } = {}) {
  if (flags.project) return { project: await resolveNamedProject(String(flags.project)), created: false };

  const identity = detectIdentity();
  const query = new URLSearchParams();
  if (identity.repo_url) query.set("repo_url", identity.repo_url);
  query.set("local_key", identity.local_key);

  try {
    const hit = await api.get(`/api/projects/find?${query}`);
    return { project: hit.project, created: false, identity };
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  if (!create) {
    throw new CliError(`This directory is not registered with TaskHub (${identity.dir}).`, {
      hint: "Run `taskhub init` to register it, or pass --project <name>.",
    });
  }
  if (isUnsafeAutoRegister(identity)) {
    throw new CliError(`Refusing to register ${identity.dir} as a project: it is not a project folder.`, {
      hint: "cd into a project, or pass --project <name>.",
    });
  }
  const body = { local_key: identity.local_key };
  if (identity.repo_url) body.repo_url = identity.repo_url;
  if (flags.name) body.name = String(flags.name);
  const result = await api.post("/api/projects/ensure", body);
  return { project: result.project, created: result.created, identity };
}

// ------------------------------------------------------------------ output

const short = (id) => id.slice(0, 8);
const isJson = (flags) => Boolean(flags.json);
const out = (s = "") => process.stdout.write(s + "\n");
const printJson = (v) => out(JSON.stringify(v, null, 2));

function taskLine(t, { withProject = false } = {}) {
  const box = t.completed ? "[x]" : "[ ]";
  const proj = withProject && t.project_name ? `${t.project_name}  ` : "";
  const note = t.notes ? `\n       note: ${t.notes.split(/\r?\n/)[0].slice(0, 110)}` : "";
  return `${box} ${short(t.id)}  ${proj}${t.title}${note}`;
}

// ---------------------------------------------------------------- commands

async function cmdProjects(flags) {
  const { projects } = await api.get("/api/projects");
  let currentId;
  try {
    const id = detectIdentity();
    const q = new URLSearchParams();
    if (id.repo_url) q.set("repo_url", id.repo_url);
    q.set("local_key", id.local_key);
    currentId = (await api.get(`/api/projects/find?${q}`)).project.id;
  } catch {
    /* not inside a registered project */
  }
  if (isJson(flags)) return printJson({ projects, current: currentId ?? null });
  if (projects.length === 0) return out("No projects yet. Run `taskhub init` inside a project folder.");
  const width = Math.max(...projects.map((p) => p.name.length));
  for (const p of projects) {
    const mark = p.id === currentId ? "*" : " ";
    out(`${mark} ${short(p.id)}  ${p.name.padEnd(width)}  ${String(p.open_count).padStart(3)} open${p.repo_url ? `  ${p.repo_url}` : ""}`);
  }
}

async function cmdInit(flags) {
  const { project, created } = await currentProject(flags, { create: true });
  if (isJson(flags)) return printJson({ project, created });
  out(created ? `Registered new project "${project.name}" (${short(project.id)}).` : `Already registered: "${project.name}" (${short(project.id)}).`);
}

async function cmdList(flags) {
  const status = flags.done ? "done" : flags.status || (flags.all ? "all" : "open");
  if (!["open", "done", "all"].includes(status)) throw usage("--status must be open, done or all");

  if (flags["all-projects"]) {
    const { tasks } = await api.get(`/api/tasks?status=${status}`);
    if (isJson(flags)) return printJson({ tasks });
    if (tasks.length === 0) return out("Nothing here.");
    // The API orders globally; group by project here, keeping each project's own order.
    const groups = new Map();
    for (const t of tasks) groups.set(t.project_name, [...(groups.get(t.project_name) ?? []), t]);
    for (const [name, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      out(`\n${name}`);
      for (const t of list) out("  " + taskLine(t));
    }
    return;
  }

  const { project } = await currentProject(flags);
  const { tasks } = await api.get(`/api/tasks?project_id=${project.id}&status=${status}`);
  if (isJson(flags)) return printJson({ project, tasks });
  const open = tasks.filter((t) => !t.completed).length;
  const done = tasks.length - open;
  const summary = status === "open" ? `${open} open` : status === "done" ? `${done} completed` : `${open} open, ${done} completed`;
  out(`${project.name} - ${summary}`);
  if (tasks.length === 0) return out(status === "open" ? "No open tasks." : "Nothing here.");
  for (const t of tasks) out(taskLine(t));
}

async function cmdAdd(flags, positional) {
  const title = (flags.title ? String(flags.title) : positional.join(" ")).trim();
  if (!title) throw usage('Usage: taskhub add "task title" [--notes "..."] [--project <name>]');
  const { project, created: registered } = await currentProject(flags, { create: !flags.project });
  const body = { project_id: project.id, title };
  if (flags.notes) body.notes = String(flags.notes);
  const result = await api.post("/api/tasks", body);
  if (isJson(flags)) return printJson({ ...result, project, project_registered: registered });
  if (registered) out(`Registered new project "${project.name}" (${short(project.id)}).`);
  out(result.created ? `Added ${short(result.task.id)}  ${result.task.title}  (${project.name})` : `Already open ${short(result.task.id)}  ${result.task.title}  (${project.name}) - not duplicated`);
}

async function setCompleted(ids, completed, flags) {
  if (ids.length === 0) throw usage(`Usage: taskhub ${completed ? "done" : "reopen"} <task-id> [more ids]`);
  const results = [];
  let failed = false;
  for (const id of ids) {
    try {
      const { task } = await api.post(`/api/tasks/${encodeURIComponent(id)}/${completed ? "complete" : "reopen"}`);
      results.push(task);
      if (!isJson(flags)) out(`${completed ? "Completed" : "Reopened"} ${short(task.id)}  ${task.title}`);
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      failed = true;
      process.stderr.write(`${id}: ${err.message}\n`);
    }
  }
  if (isJson(flags)) printJson({ tasks: results });
  if (failed) process.exitCode = 1;
}

async function cmdEdit(flags, positional) {
  const [id, ...rest] = positional;
  if (!id) throw usage('Usage: taskhub edit <task-id> ["new title"] [--notes "..."]');
  const body = {};
  const title = rest.join(" ").trim();
  if (title) body.title = title;
  if (flags.notes !== undefined) body.notes = flags.notes === true ? null : String(flags.notes);
  if (Object.keys(body).length === 0) throw usage("Nothing to change: give a new title and/or --notes");
  const { task } = await api.patch(`/api/tasks/${encodeURIComponent(id)}`, body);
  if (isJson(flags)) return printJson({ task });
  out(`Updated ${short(task.id)}  ${task.title}`);
}

async function cmdDelete(flags, positional) {
  const [id] = positional;
  if (!id) throw usage("Usage: taskhub delete <task-id> --yes");
  if (!flags.yes) throw usage("Deleting is permanent. Re-run with --yes to confirm.");
  await api.del(`/api/tasks/${encodeURIComponent(id)}`);
  if (isJson(flags)) return printJson({ ok: true });
  out(`Deleted ${id}`);
}

async function cmdStatus(flags) {
  const cfg = readConfig();
  const report = { cli: VERSION, url: cfg.url || null, token: cfg.token ? `set (ends ...${cfg.token.slice(-4)})` : null };
  const lines = [];
  let ok = true;

  if (!cfg.url || !cfg.token) {
    ok = false;
    lines.push("Configured : NO - run `taskhub login`");
  } else {
    lines.push(`Server     : ${cfg.url}`);
    try {
      await api.get("/api/health");
      report.connected = true;
      lines.push("Connection : OK (authenticated, database reachable)");
    } catch (err) {
      ok = false;
      report.connected = false;
      report.error = err.message;
      lines.push(`Connection : FAILED - ${err.message}`);
    }
  }

  const identity = detectIdentity();
  report.directory = identity.dir;
  report.repo_url = identity.repo_url ?? null;
  lines.push(`Directory  : ${identity.dir}`);
  lines.push(`Git remote : ${identity.repo_url ?? (identity.inGit ? "(none)" : "(not a git repository)")}`);

  if (report.connected) {
    try {
      const { project } = await currentProject(flags);
      const { tasks } = await api.get(`/api/tasks?project_id=${project.id}&status=open`);
      report.project = project;
      report.open = tasks.length;
      lines.push(`Project    : ${project.name} (${short(project.id)}) - ${tasks.length} open`);
    } catch (err) {
      report.project = null;
      lines.push(`Project    : not registered - run \`taskhub init\``);
      if (err.status && err.status !== 404) ok = false;
    }
  }

  if (isJson(flags)) printJson({ ok, ...report });
  else lines.forEach((l) => out(l));
  if (!ok) process.exitCode = 1;
}

function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin });
      rl.once("line", (l) => {
        resolve(l.trim()); // resolve first: close() fires the "close" handler below
        rl.close();
      });
      rl.once("close", () => resolve(""));
    });
  }
  if (!hidden) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question(question, (a) => {
        rl.close();
        resolve(a.trim());
      });
    });
  }
  return new Promise((resolve) => {
    process.stderr.write(question);
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(value.trim());
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function cmdLogin(flags) {
  const existing = readConfig();
  let url = flags.url ? String(flags.url) : "";
  if (!url) url = await ask(`TaskHub URL${existing.url ? ` [${existing.url}]` : ""} (e.g. https://taskhub.vercel.app): `);
  url = (url || existing.url).replace(/\/+$/, "");
  assertSafeUrl(url);

  let token = flags.token ? String(flags.token) : "";
  if (flags["token-stdin"]) token = await ask("");
  if (!token) token = await ask("API token (input hidden): ", { hidden: true });
  if (!token) throw usage("No token given.");

  // Verify before saving, so a typo never overwrites a working config.
  let res;
  try {
    res = await fetch(url + "/api/health", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new CliError(`Could not reach ${url} (${err?.cause?.message || err.message}). Nothing was saved.`);
  }
  if (res.status === 401) throw new CliError("The server rejected that token. Nothing was saved.");
  if (!res.ok) throw new CliError(`The server answered HTTP ${res.status}. Nothing was saved.`);

  saveConfig({ url, token });
  out(`Logged in. Saved to ${CONFIG_FILE}`);
}

const HELP = `taskhub ${VERSION} - the shared task list for you and your AI agents

Usage: taskhub <command> [options]

  status                     Check connection, auth and which project this folder is
  projects                   List all projects (* = the current folder's project)
  init [--name "Name"]       Register this folder's project (idempotent, never duplicates)
  list                       Open tasks for this project
    --done | --all           Completed only | open and completed
    --all-projects           Every project (alias: -g)
  add "Task title"           Add a task (registers the project if needed; skips exact duplicates)
    --notes "text"
  done <id> [id...]          Mark complete (an 8-character id prefix is enough)
  reopen <id> [id...]        Mark not complete
  edit <id> ["New title"]    Change title and/or --notes "text"
  delete <id> --yes          Delete permanently
  login [--url U]            Save the server URL and API token (token is prompted, hidden)

Options for most commands:
  --project, -p <name|id>    Act on a project other than this folder's
  --json                     Machine-readable output

Config: ~/.taskhub/config.json, or the TASKHUB_URL and TASKHUB_TOKEN environment variables.
Exit codes: 0 ok - 1 failed (including sync failures) - 2 bad usage.`;

// -------------------------------------------------------------------- main

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") return out(HELP);
  if (command === "--version" || command === "-v" || command === "version") return out(VERSION);

  const { flags, positional } = parseArgs(rest);
  if (flags.help) return out(HELP);

  switch (command) {
    case "status":
      return cmdStatus(flags);
    case "projects":
      return cmdProjects(flags);
    case "init":
      return cmdInit(flags);
    case "list":
    case "ls":
      return cmdList(flags);
    case "add":
      return cmdAdd(flags, positional);
    case "done":
    case "complete":
      return setCompleted(positional, true, flags);
    case "reopen":
      return setCompleted(positional, false, flags);
    case "edit":
      return cmdEdit(flags, positional);
    case "delete":
    case "rm":
      return cmdDelete(flags, positional);
    case "login":
      return cmdLogin(flags);
    default:
      throw usage(`Unknown command '${command}'`);
  }
}

if (process.argv[1] && basename(process.argv[1]).startsWith("taskhub")) {
  main(process.argv.slice(2)).catch((err) => {
    const json = process.argv.includes("--json");
    if (err instanceof CliError) {
      if (json) process.stderr.write(JSON.stringify({ error: { message: err.message, hint: err.hint ?? null } }) + "\n");
      else process.stderr.write(`${err.message}${err.hint ? `\n${err.hint}` : ""}\n`);
      process.exit(err.exitCode);
    }
    process.stderr.write(`taskhub: unexpected error: ${err?.stack || err}\n`);
    process.exit(1);
  });
}

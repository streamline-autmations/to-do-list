import { readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getSql } from "../../src/lib/db";
import { TEST_TOKEN } from "../global-setup";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface RouteEntry {
  regex: RegExp;
  keys: string[];
  dynamic: number;
  file: string;
}

const API_ROOT = resolve(__dirname, "../../src/app/api");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : name === "route.ts" ? [p] : [];
  });
}

/** Builds the same route table Next.js derives from src/app/api/**\/route.ts. */
const table: RouteEntry[] = walk(API_ROOT)
  .map((file) => {
    const segs = relative(API_ROOT, join(file, "..")).split(sep).filter(Boolean);
    const keys: string[] = [];
    const pattern = segs
      .map((s) => {
        const m = /^\[(.+)\]$/.exec(s);
        if (!m) return s;
        keys.push(m[1]!);
        return "([^/]+)";
      })
      .join("/");
    return { regex: new RegExp(`^/api/${pattern}/?$`), keys, dynamic: keys.length, file };
  })
  .sort((a, b) => a.dynamic - b.dynamic);

/** Dispatch a Request exactly like Next would: pick the route file, call the method export. */
export async function dispatch(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  for (const entry of table) {
    const m = entry.regex.exec(pathname);
    if (!m) continue;
    const mod = (await import(pathToFileURL(entry.file).href)) as Record<string, Handler | undefined>;
    const handler = mod[req.method];
    if (!handler) return new Response("Method Not Allowed", { status: 405 });
    const params = Object.fromEntries(entry.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
    return handler(req, { params: Promise.resolve(params) });
  }
  return new Response("Not Found", { status: 404 });
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function api<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const token = opts.token === undefined ? TEST_TOKEN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await dispatch(
    new Request(`http://taskhub.test${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export async function resetDb(): Promise<void> {
  await getSql()`truncate tasks, projects, login_attempts restart identity cascade`;
}

/** Real HTTP server wrapping the route handlers, for exercising the CLI end to end. */
export async function startHttpServer(): Promise<{ url: string; server: Server }> {
  const server = createServer(async (nodeReq, nodeRes) => {
    const chunks: Buffer[] = [];
    for await (const c of nodeReq) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(nodeReq.headers)) if (v !== undefined) headers.set(k, String(v));
    const hasBody = !["GET", "HEAD"].includes(nodeReq.method ?? "GET") && body.length > 0;
    const res = await dispatch(
      new Request(`http://${nodeReq.headers.host}${nodeReq.url}`, {
        method: nodeReq.method!,
        headers,
        ...(hasBody ? { body } : {}),
      }),
    );
    nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
    nodeRes.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, server };
}

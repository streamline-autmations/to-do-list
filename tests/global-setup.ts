import { createServer } from "node:net";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { hashPassword } from "../src/lib/auth";

export const TEST_PASSWORD = "correct horse battery staple";
export const TEST_TOKEN = "test-token-0123456789abcdef0123456789abcdef";

const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });

/** One real (in-memory) Postgres for the whole run, reached through the production `postgres` driver. */
export default async function setup() {
  const db = await PGlite.create();
  const dir = resolve(__dirname, "../supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(resolve(dir, f), "utf8"));
  }
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 1 });
  await server.start();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.TASKHUB_DB_POOL_MAX = "1";
  process.env.TASKHUB_API_TOKEN = TEST_TOKEN;
  process.env.TASKHUB_SESSION_SECRET = "s".repeat(48);
  process.env.TASKHUB_PASSWORD_HASH = await hashPassword(TEST_PASSWORD);

  return async () => {
    await server.stop();
    await db.close();
  };
}

// A throwaway local Postgres (PGlite) so you can run TaskHub with no Supabase account at all.
// Data lives in .taskhub/dev-db (git-ignored). Stop with Ctrl+C.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, ".taskhub/dev-db");
const port = Number(process.env.TASKHUB_DEV_DB_PORT ?? 54329);
mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create(dataDir);
const migrations = resolve(root, "supabase/migrations");
for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(resolve(migrations, f), "utf8"));
}

const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 1 });
await server.start();
console.log(
  `Local TaskHub database ready. Put these in .env.local:\n\n` +
    `  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/postgres\n` +
    `  TASKHUB_DB_POOL_MAX=1\n\n` +
    `(PGlite is a single-session database: keep the pool at 1 locally. Real Postgres/Supabase needs no such limit.)\n`,
);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

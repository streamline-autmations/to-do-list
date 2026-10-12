// Apply supabase/migrations/*.sql to DATABASE_URL. Safe to re-run: applied files are recorded.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { loadEnv } from "./_env.mjs";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local (see .env.example).");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
const sql = postgres(url, { ssl: isLocal ? false : "require", prepare: false, max: 1, onnotice: () => {} });

try {
  await sql`create table if not exists taskhub_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from taskhub_migrations`).map((r) => r.name));
  const dir = resolve(import.meta.dirname, "../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    process.stdout.write(`applying ${file} ... `);
    await sql.unsafe(readFileSync(resolve(dir, file), "utf8"));
    await sql`insert into taskhub_migrations (name) values (${file})`;
    console.log("ok");
    applied++;
  }
  console.log(applied ? `Done: ${applied} migration(s) applied.` : "Database is already up to date.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}

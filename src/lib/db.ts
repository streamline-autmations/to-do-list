import postgres from "postgres";

export type Sql = postgres.Sql;

const globalForDb = globalThis as unknown as { __taskhubSql?: Sql };

/**
 * The only place a database connection is created. Server-only: DATABASE_URL
 * is a secret and must never reach client code.
 */
export function getSql(): Sql {
  if (globalForDb.__taskhubSql) return globalForDb.__taskhubSql;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  globalForDb.__taskhubSql = postgres(url, {
    ssl: isLocal ? false : "require",
    // Works with Supabase's transaction pooler (pgbouncer), which has no prepared statements.
    prepare: false,
    max: Number(process.env.TASKHUB_DB_POOL_MAX ?? 3),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return globalForDb.__taskhubSql;
}

/** Test seam: close and forget the cached connection. */
export async function resetSql(): Promise<void> {
  const sql = globalForDb.__taskhubSql;
  globalForDb.__taskhubSql = undefined;
  if (sql) await sql.end({ timeout: 1 });
}

/** Postgres error code helper (23505 unique_violation, 23503 foreign_key_violation, ...). */
export function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "constraint_name" in err
    ? String((err as { constraint_name: unknown }).constraint_name)
    : undefined;
}

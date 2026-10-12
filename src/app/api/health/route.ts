import { getSql } from "@/lib/db";
import { route } from "@/lib/http";

/** Authenticated liveness check: proves the token works and the database is reachable. */
export const GET = route(async () => {
  await getSql()`select 1`;
  return { ok: true, database: true };
});

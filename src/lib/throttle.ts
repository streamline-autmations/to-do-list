import { getSql } from "./db";
import { tooMany } from "./errors";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 8;

/**
 * Reserve a login attempt for this IP *before* the password is checked.
 *
 * The row is committed first and counted second, so the k-th concurrent request
 * always sees at least k rows: no matter how many arrive at once, at most
 * MAX_ATTEMPTS of them get past this point to the (expensive) password check.
 */
export async function reserveAttempt(ip: string): Promise<void> {
  const sql = getSql();
  await sql`insert into login_attempts (ip) values (${ip})`;
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from login_attempts
    where ip = ${ip} and attempted_at > now() - make_interval(mins => ${WINDOW_MINUTES})`;
  if ((row?.n ?? 0) > MAX_ATTEMPTS) {
    throw tooMany(`Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  }
  await sql`delete from login_attempts where attempted_at < now() - interval '1 day'`;
}

/** A successful login wipes this IP's attempts. */
export async function clearAttempts(ip: string): Promise<void> {
  await getSql()`delete from login_attempts where ip = ${ip}`;
}

import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ApiError, forbidden, unauthorized } from "./errors";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const SESSION_COOKIE = "taskhub_session";
export const SESSION_DAYS = 30;

// ---------------------------------------------------------------- primitives

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function notConfigured(name: string): never {
  console.error(`[taskhub] ${name} is not configured`);
  throw new ApiError(500, "not_configured", "The server is not configured");
}

// ------------------------------------------------------------------ password

const SCRYPT = { N: 65536, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 };

/**
 * Returns `scrypt.N.r.p.salt.hash` (base64url parts). Dots, not `$`, so .env loaders
 * (which expand `$VAR`) and shells cannot mangle it. Used by `npm run hash-password`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join(".");
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Strict parse. Anything unexpected is rejected: a malformed hash must never be able to match. */
function parseHash(stored: string) {
  const parts = stored.split(".");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(R) || R < 1 || R > 32 || !Number.isInteger(P) || P < 1 || P > 16) return null;
  if (!B64URL.test(salt) || !B64URL.test(hash)) return null;
  const saltBuf = Buffer.from(salt, "base64url");
  const hashBuf = Buffer.from(hash, "base64url");
  if (saltBuf.length < 16 || hashBuf.length !== 32) return null;
  return { N, R, P, saltBuf, hashBuf };
}

export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const h = parseHash(stored);
  if (!h) return false;
  const key = await scrypt(password, h.saltBuf, h.hashBuf.length, {
    N: h.N,
    r: h.R,
    p: h.P,
    maxmem: 128 * h.N * h.R + 4 * 1024 * 1024,
  });
  return key.length === h.hashBuf.length && timingSafeEqual(key, h.hashBuf);
}

/** Check a login attempt against TASKHUB_PASSWORD_HASH (preferred) or TASKHUB_PASSWORD. */
export async function checkLoginPassword(password: string): Promise<boolean> {
  const hash = env("TASKHUB_PASSWORD_HASH");
  if (hash) {
    if (!parseHash(hash)) return notConfigured("TASKHUB_PASSWORD_HASH is malformed; regenerate it with `npm run hash-password`");
    return verifyPasswordHash(password, hash);
  }
  const plain = env("TASKHUB_PASSWORD");
  if (plain) return safeEqual(password, plain);
  return notConfigured("TASKHUB_PASSWORD_HASH");
}

// ------------------------------------------------------------------- session

function sessionSecret(): string {
  const s = env("TASKHUB_SESSION_SECRET");
  if (!s || s.length < 32) return notConfigured("TASKHUB_SESSION_SECRET (32+ chars)");
  return s;
}

const sign = (payload: string) => createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

/** `<expiry-ms>.<hmac>` - nothing sensitive inside, tamper-evident, expires on its own. */
export function createSessionToken(now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp)) return false;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return false;
  }
  const expected = createHmac("sha256", secret).update(exp).digest("base64url");
  return safeEqual(mac, expected) && Number(exp) > now;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86_400}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearedCookieHeader(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto.split(",")[0]?.trim() === "https";
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}

// ----------------------------------------------------------------- API token

/** TASKHUB_API_TOKEN may hold several comma-separated tokens so you can rotate without downtime. */
export function verifyApiToken(token: string): boolean {
  const configured = (env("TASKHUB_API_TOKEN") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (configured.length === 0) return false;
  // Evaluate every candidate so timing does not reveal which one matched.
  let ok = false;
  for (const t of configured) ok = safeEqual(token, t) || ok;
  return ok;
}

// ------------------------------------------------------------------ request

export type AuthKind = "token" | "session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Browsers always send Origin on cross-site writes; require it to match this host. */
export function assertSameOrigin(req: Request): void {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden("Cross-origin request blocked");
    }
    if (host && originHost === host.split(",")[0]?.trim()) return;
    throw forbidden("Cross-origin request blocked");
  }
  if (req.headers.get("sec-fetch-site") === "same-origin") return;
  throw forbidden("Cross-origin request blocked");
}

/**
 * Accepts `Authorization: Bearer <TASKHUB_API_TOKEN>` (CLI and agents) or the
 * signed session cookie (web UI). Cookie-authenticated writes are also CSRF-checked.
 */
export function authenticate(req: Request): AuthKind {
  const header = req.headers.get("authorization");
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m?.[1] && verifyApiToken(m[1].trim())) return "token";
    throw unauthorized("Invalid API token");
  }
  if (verifySessionToken(readCookie(req, SESSION_COOKIE))) {
    if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);
    return "session";
  }
  throw unauthorized();
}

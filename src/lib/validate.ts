import { badRequest } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PREFIX = /^[0-9a-f]{6,32}$/i;
const MAX_BODY_BYTES = 100_000;

export const isUuid = (v: string) => UUID.test(v);
export const isIdPrefix = (v: string) => ID_PREFIX.test(v);

export function requireUuid(value: string, label = "id"): string {
  if (!UUID.test(value)) throw badRequest(`'${label}' must be a UUID`);
  return value.toLowerCase();
}

/** Read a JSON object body. An empty body is treated as `{}`. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw badRequest("Request body too large", "payload_too_large");
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Reject fields we do not know about, so typos fail loudly instead of being ignored. */
export function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw badRequest(`Unknown field '${key}'. Allowed: ${allowed.join(", ")}`);
    }
  }
}

interface StringOpts {
  max: number;
  /** Collapse internal whitespace runs to single spaces (titles, names). */
  collapse?: boolean;
}

/** Required, non-empty string. */
export function reqString(body: Record<string, unknown>, key: string, opts: StringOpts): string {
  const v = body[key];
  if (typeof v !== "string") throw badRequest(`'${key}' is required and must be a string`);
  const s = clean(v, opts);
  if (!s) throw badRequest(`'${key}' must not be empty`);
  if (s.length > opts.max) throw badRequest(`'${key}' must be at most ${opts.max} characters`);
  return s;
}

/** Optional string: undefined when absent, null when null or blank. */
export function optString(body: Record<string, unknown>, key: string, opts: StringOpts): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v !== "string") throw badRequest(`'${key}' must be a string or null`);
  const s = clean(v, opts);
  if (s.length > opts.max) throw badRequest(`'${key}' must be at most ${opts.max} characters`);
  return s === "" ? null : s;
}

export function optBool(body: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (typeof v !== "boolean") throw badRequest(`'${key}' must be true or false`);
  return v;
}

export function optNumber(body: Record<string, unknown>, key: string): number | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e12) {
    throw badRequest(`'${key}' must be a finite number`);
  }
  return v;
}

function clean(v: string, { collapse }: StringOpts): string {
  const s = v.replace(/\u0000/g, "");
  return collapse ? s.replace(/\s+/g, " ").trim() : s.trim();
}

/** Parse ?limit= style integers. */
export function intParam(value: string | null, fallback: number, min: number, max: number, label: string): number {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`'${label}' must be an integer between ${min} and ${max}`);
  return n;
}

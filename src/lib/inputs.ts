import { badRequest } from "./errors";
import { normalizeLocalKey, normalizeRepoUrl } from "./identity";
import { optString } from "./validate";

// Must match the CHECK constraints in supabase/migrations/0001_init.sql.
export const MAX_REPO = 300;
export const MAX_KEY = 500;

/** Parse the optional repo_url / local_key fields shared by project endpoints. */
export function parseIdentity(body: Record<string, unknown>): {
  repo_url: string | null | undefined;
  local_key: string | null | undefined;
} {
  const rawRepo = optString(body, "repo_url", { max: 500 });
  const rawKey = optString(body, "local_key", { max: 600 });

  const repo_url = typeof rawRepo === "string" ? normalizeRepoUrl(rawRepo) : rawRepo;
  if (typeof rawRepo === "string" && !repo_url) throw badRequest("'repo_url' is not a recognisable repository URL");
  if (repo_url && repo_url.length > MAX_REPO) throw badRequest(`'repo_url' is too long once normalised (max ${MAX_REPO})`);

  const local_key = typeof rawKey === "string" ? normalizeLocalKey(rawKey) : rawKey;
  if (typeof rawKey === "string" && !local_key) throw badRequest("'local_key' is not a recognisable path");
  if (local_key && local_key.length > MAX_KEY) throw badRequest(`'local_key' is too long once normalised (max ${MAX_KEY})`);

  return { repo_url, local_key };
}

export function parseStatus(value: string | null): "open" | "done" | "all" {
  if (value === null || value === "") return "open";
  if (value === "open" || value === "done" || value === "all") return value;
  throw badRequest("'status' must be one of: open, done, all");
}

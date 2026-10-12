import { parseIdentity } from "@/lib/inputs";
import { json, route } from "@/lib/http";
import { ensureProject } from "@/lib/repo";
import { onlyKeys, optString, readJson } from "@/lib/validate";

/**
 * POST /api/projects/ensure - idempotent register. Agents call this on every
 * session start; it never creates a duplicate.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  onlyKeys(body, ["name", "repo_url", "local_key"]);
  const name = optString(body, "name", { max: 120, collapse: true });
  const { repo_url, local_key } = parseIdentity(body);
  const result = await ensureProject({ name: name ?? null, repo_url: repo_url ?? null, local_key: local_key ?? null });
  return json(result, result.created ? 201 : 200);
});

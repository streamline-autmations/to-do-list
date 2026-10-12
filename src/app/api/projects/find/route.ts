import { badRequest, notFound } from "@/lib/errors";
import { normalizeLocalKey, normalizeRepoUrl } from "@/lib/identity";
import { route } from "@/lib/http";
import { findProject } from "@/lib/repo";

/** GET /api/projects/find?repo_url=...&local_key=...  ->  200 { project, matched_by } | 404 */
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const rawRepo = params.get("repo_url");
  const rawKey = params.get("local_key");
  if (!rawRepo && !rawKey) throw badRequest("Provide 'repo_url' and/or 'local_key'");

  const repo_url = rawRepo ? normalizeRepoUrl(rawRepo) : null;
  const local_key = rawKey ? normalizeLocalKey(rawKey) : null;
  if ((rawRepo && !repo_url) || (rawKey && !local_key)) throw badRequest("Unrecognisable 'repo_url' or 'local_key'");
  const hit = await findProject({ repo_url, local_key });
  if (!hit) throw notFound("Project");
  return hit;
});

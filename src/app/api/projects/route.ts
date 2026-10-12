import { parseIdentity } from "@/lib/inputs";
import { json, route } from "@/lib/http";
import { createProject, listProjects } from "@/lib/repo";
import { onlyKeys, readJson, reqString } from "@/lib/validate";

export const GET = route(async () => ({ projects: await listProjects() }));

export const POST = route(async (req) => {
  const body = await readJson(req);
  onlyKeys(body, ["name", "repo_url", "local_key"]);
  const name = reqString(body, "name", { max: 120, collapse: true });
  const { repo_url, local_key } = parseIdentity(body);
  const project = await createProject({ name, repo_url: repo_url ?? null, local_key: local_key ?? null });
  return json({ project }, 201);
});

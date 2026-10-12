import { parseIdentity } from "@/lib/inputs";
import { json, route } from "@/lib/http";
import { deleteProject, getProject, updateProject } from "@/lib/repo";
import { onlyKeys, optString, readJson, requireUuid } from "@/lib/validate";

type P = { id: string };

export const GET = route<P>(async (_req, { params }) => ({ project: await getProject(requireUuid(params.id)) }));

export const PATCH = route<P>(async (req, { params }) => {
  const id = requireUuid(params.id);
  const body = await readJson(req);
  onlyKeys(body, ["name", "repo_url", "local_key"]);
  const name = optString(body, "name", { max: 120, collapse: true });
  const { repo_url, local_key } = parseIdentity(body);
  const project = await updateProject(id, {
    ...(typeof name === "string" ? { name } : {}),
    ...(repo_url !== undefined ? { repo_url } : {}),
    ...(local_key !== undefined ? { local_key } : {}),
  });
  return { project };
});

export const DELETE = route<P>(async (_req, { params }) => {
  await deleteProject(requireUuid(params.id));
  return json({ ok: true });
});

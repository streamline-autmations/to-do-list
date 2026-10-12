/**
 * Project identity helpers. The server is the single source of truth for how a
 * repository URL or a directory path is normalised, so the CLI, the web app and
 * any other client always resolve to the same project.
 */

/**
 *  https://user:tok@GitHub.com/Owner/Repo.git  -> github.com/owner/repo
 *  git@github.com:Owner/Repo.git               -> github.com/owner/repo
 *  ssh://git@github.com:22/Owner/Repo/         -> github.com/owner/repo
 */
export function normalizeRepoUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;

  // scp-like syntax: [user@]host:path (but not a Windows drive like C:\ or C:/)
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(?![\\/])(.+)$/.exec(s);
  if (scp && !/^[a-z]$/i.test(scp[1] ?? "")) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
    s = s.replace(/^[^@/]*@/, ""); // credentials / user
    s = s.replace(/^([^/:]+):(?:22|80|443|9418)(?=\/|$)/, "$1"); // default ports only: 8443 and 9443 are different servers
  }

  s = s
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return s || null;
}

/**
 *  C:\Users\Me\Code\App          -> c:/users/me/code/app
 *  /mnt/c/Users/Me/Code/App      -> c:/users/me/code/app   (same folder seen from WSL)
 *  \\wsl.localhost\Ubuntu\home\me\App -> /home/me/App       (same folder seen from Windows; Linux case is kept)
 */
export function normalizeLocalKey(input: string): string | null {
  let s = input.trim().replace(/\\/g, "/");
  if (!s) return null;

  const wslUnc = /^\/\/(?:wsl\$|wsl\.localhost)\/[^/]+(\/.*)?$/i.exec(s);
  if (wslUnc) s = wslUnc[1] ?? "/";

  const mnt = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(s);
  if (mnt) s = `${mnt[1]}:/${mnt[2] ?? ""}`;

  s = s.replace(/\/{2,}/g, "/");
  // Windows paths are case-insensitive; Linux paths are not (/home/me/App and /home/me/app differ).
  if (/^[a-z]:/i.test(s)) s = s.toLowerCase();
  if (s.length > 1 && s.endsWith("/") && !/^[a-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s || null;
}

/** A readable default project name from a normalised repo URL or directory key. */
export function deriveName(repoUrl: string | null, localKey: string | null): string | null {
  const source = repoUrl ?? localKey;
  if (!source) return null;
  const last = source.split("/").filter(Boolean).pop();
  return last && !/^[a-z]:$/.test(last) ? last : null;
}

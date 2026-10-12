import { describe, expect, it } from "vitest";
import { deriveName, normalizeLocalKey, normalizeRepoUrl } from "../src/lib/identity";

describe("normalizeRepoUrl", () => {
  it.each([
    ["https://github.com/Owner/Repo.git", "github.com/owner/repo"],
    ["https://user:ghp_secret@GitHub.com/Owner/Repo", "github.com/owner/repo"],
    ["git@github.com:Owner/Repo.git", "github.com/owner/repo"],
    ["ssh://git@github.com:22/Owner/Repo.git/", "github.com/owner/repo"],
    ["git://github.com/owner/repo", "github.com/owner/repo"],
    ["github.com/owner/repo", "github.com/owner/repo"],
    ["https://github.com/owner/repo/", "github.com/owner/repo"],
    ["https://github.com/owner/repo?tab=readme#x", "github.com/owner/repo"],
    ["https://dev.azure.com/org/proj/_git/repo", "dev.azure.com/org/proj/_git/repo"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeRepoUrl(input)).toBe(expected);
  });

  it("maps every clone style of one repo to the same key", () => {
    const keys = new Set(
      [
        "https://github.com/acme/shop.git",
        "git@github.com:acme/shop.git",
        "ssh://git@github.com/acme/shop",
        "https://token@github.com/ACME/Shop",
      ].map(normalizeRepoUrl),
    );
    expect(keys.size).toBe(1);
  });

  it("treats default ports as noise but keeps real ones", () => {
    expect(normalizeRepoUrl("ssh://git@github.com:22/a/b")).toBe("github.com/a/b");
    expect(normalizeRepoUrl("https://github.com:443/a/b")).toBe("github.com/a/b");
    expect(normalizeRepoUrl("https://git.example:8443/a/b")).not.toBe(normalizeRepoUrl("https://git.example:9443/a/b"));
    expect(normalizeRepoUrl("https://git.example:8443/a/b")).toBe("git.example:8443/a/b");
  });

  it("returns null for blanks", () => {
    expect(normalizeRepoUrl("   ")).toBeNull();
  });
});

describe("normalizeLocalKey", () => {
  it("treats Windows and WSL views of the same folder as equal", () => {
    const a = normalizeLocalKey("C:\\Users\\Chris\\Desktop\\App\\");
    expect(a).toBe("c:/users/chris/desktop/app");
    expect(normalizeLocalKey("/mnt/c/Users/Chris/Desktop/App")).toBe(a);
  });
  it("maps the Windows UNC view of a WSL folder to its Linux path", () => {
    expect(normalizeLocalKey("\\\\wsl.localhost\\Ubuntu\\home\\chris\\fitness-os")).toBe("/home/chris/fitness-os");
    expect(normalizeLocalKey("\\\\wsl$\\Ubuntu\\home\\chris\\x")).toBe("/home/chris/x");
  });
  it("keeps Linux path case (/home/me/App and /home/me/app are different folders)", () => {
    expect(normalizeLocalKey("/home/me/App")).not.toBe(normalizeLocalKey("/home/me/app"));
    expect(normalizeLocalKey("\\\\wsl.localhost\\Ubuntu\\home\\me\\App")).toBe("/home/me/App");
  });
  it("keeps drive roots and unix roots intact", () => {
    expect(normalizeLocalKey("C:\\")).toBe("c:/");
    expect(normalizeLocalKey("/")).toBe("/");
  });
});

describe("deriveName", () => {
  it("prefers the repo name, then the directory", () => {
    expect(deriveName("github.com/acme/shop", "c:/x/other")).toBe("shop");
    expect(deriveName(null, "c:/users/me/blom-admin")).toBe("blom-admin");
    expect(deriveName(null, null)).toBeNull();
  });
});

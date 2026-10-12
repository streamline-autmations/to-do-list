// Adds (or updates, or removes) the TaskHub block in your global agent instruction files.
//
//   node scripts/install-agent-instructions.mjs [--claude PATH] [--codex PATH] [--only claude|codex]
//                                               [--dry-run] [--uninstall]
//
// Safety:
//  * It only ever APPENDS one marked block (or replaces that same block on update). Nothing else is touched.
//  * It shows you exactly what will be added and asks before every file. There is no --yes flag.
//  * It copies the existing file to <file>.bak-<timestamp> first, then verifies the original text is intact.
//  * Without an interactive terminal it can only do a dry run.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const BEGIN = "<!-- taskhub:begin -->";
const END = "<!-- taskhub:end -->";
const root = resolve(import.meta.dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const targets = [
  { id: "claude", label: "Claude Code", file: resolve(value("claude") ?? join(homedir(), ".claude", "CLAUDE.md")), snippet: join(root, "instructions/claude-snippet.md") },
  { id: "codex", label: "Codex", file: resolve(value("codex") ?? join(homedir(), ".codex", "AGENTS.md")), snippet: join(root, "instructions/codex-snippet.md") },
].filter((t) => !value("only") || t.id === value("only"));

const dryRun = flag("dry-run");
const uninstall = flag("uninstall");
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const eol = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const toEol = (text, nl) => text.replace(/\r?\n/g, nl);

function blockRange(text) {
  const a = text.indexOf(BEGIN);
  if (a === -1) return null;
  const b = text.indexOf(END, a);
  if (b === -1) throw new Error(`found "${BEGIN}" but no matching "${END}"; fix the file by hand first`);
  return [a, b + END.length];
}

function plan(target) {
  const exists = existsSync(target.file);
  const original = exists ? readFileSync(target.file, "utf8") : "";
  const nl = exists ? eol(original) : "\n";
  const snippet = toEol(readFileSync(target.snippet, "utf8").trim(), nl);
  const range = blockRange(original);

  if (uninstall) {
    if (!range) return { ...target, exists, action: "nothing to remove", original, next: original, block: "" };
    let [a, b] = range;
    while (a > 0 && /\s/.test(original[a - 1])) a--; // swallow the blank line we added
    const next = original.slice(0, a) + original.slice(b);
    return { ...target, exists, action: "remove the TaskHub block", original, next: next.endsWith(nl) || next === "" ? next : next + nl, block: original.slice(range[0], range[1]) };
  }
  if (range) {
    const next = original.slice(0, range[0]) + snippet + original.slice(range[1]);
    const same = next === original;
    return { ...target, exists, action: same ? "already up to date" : "update the existing TaskHub block", original, next, block: snippet };
  }
  const sep = original === "" ? "" : original.endsWith(nl + nl) ? "" : original.endsWith(nl) ? nl : nl + nl;
  return { ...target, exists, action: exists ? "append the TaskHub block" : "create the file", original, next: original + sep + snippet + nl, block: snippet };
}

function confirm(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      res(/^y(es)?$/i.test(a.trim()));
    });
  });
}

let failed = false;
for (const t of targets) {
  console.log(`\n=== ${t.label}: ${t.file}`);
  let p;
  try {
    p = plan(t);
  } catch (err) {
    console.log(`Skipping: ${err.message}`);
    failed = true;
    continue;
  }
  console.log(`Action: ${p.action}${p.exists ? ` (existing file: ${p.original.length} characters, left untouched except for this block)` : ""}`);
  if (p.next === p.original) continue;

  if (p.block) console.log(`\n${uninstall ? "--- removing" : "+++ adding"}:\n${p.block.split(/\r?\n/).map((l) => (uninstall ? "- " : "+ ") + l).join("\n")}\n`);
  if (dryRun) {
    console.log("(dry run: nothing written)");
    continue;
  }
  if (!interactive) {
    console.log("Not an interactive terminal, so nothing was written. Re-run it in your own terminal to approve the change.");
    continue;
  }
  if (!(await confirm(`Apply this change to ${t.file}? A backup will be made first. [y/N] `))) {
    console.log("Skipped.");
    continue;
  }

  mkdirSync(dirname(t.file), { recursive: true });
  let backup = null;
  if (p.exists) {
    backup = `${t.file}.bak-${stamp()}`;
    for (let n = 2; existsSync(backup); n++) backup = `${t.file}.bak-${stamp()}-${n}`; // never overwrite an earlier backup
    copyFileSync(t.file, backup);
    if (readFileSync(backup, "utf8") !== p.original) throw new Error("backup does not match the original; aborting before any change");
  }
  const tmp = `${t.file}.taskhub-tmp`;
  writeFileSync(tmp, p.next);
  renameSync(tmp, t.file);

  const written = readFileSync(t.file, "utf8");
  const intact = uninstall || range0(p) ? true : written.startsWith(p.original);
  if (!intact) throw new Error(`verification failed; restore from ${backup}`);
  console.log(`Done.${backup ? ` Backup: ${backup}` : ""}`);
}
process.exitCode = failed ? 1 : 0;

// An update replaces the block in the middle of the file, so "original is a prefix" only applies to appends.
function range0(p) {
  return p.action.startsWith("update");
}

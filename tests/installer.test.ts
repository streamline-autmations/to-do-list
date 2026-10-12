import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../scripts/install-agent-instructions.mjs");
let dir = "";

const run = (...args: string[]) =>
  new Promise<{ code: number; out: string }>((res) => {
    const child = execFile(process.execPath, [SCRIPT, ...args], { timeout: 20_000 }, (err, stdout, stderr) =>
      res({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
    child.stdin?.end();
  });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "taskhub-inst-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# My rules\n\nBe kind.\n");
  writeFileSync(join(dir, "AGENTS.md"), "# Codex rules\r\n\r\nBe brief.\r\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("install-agent-instructions", () => {
  const targets = () => ["--claude", join(dir, "CLAUDE.md"), "--codex", join(dir, "AGENTS.md")];

  it("--dry-run shows the block and changes nothing", async () => {
    const r = await run(...targets(), "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/append the TaskHub block/);
    expect(r.out).toMatch(/\+ <!-- taskhub:begin -->/);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# My rules\n\nBe kind.\n");
    expect(readdirSync(dir).some((f) => f.includes(".bak-"))).toBe(false);
  });

  it("without an interactive terminal it refuses to write (approval is required)", async () => {
    const r = await run(...targets());
    expect(r.out).toMatch(/Not an interactive terminal/);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# Codex rules\r\n\r\nBe brief.\r\n");
    expect(readdirSync(dir).some((f) => f.includes(".bak-") || f.endsWith(".taskhub-tmp"))).toBe(false);
  });

  it("detects an unterminated block instead of guessing", async () => {
    writeFileSync(join(dir, "BROKEN.md"), "x\n<!-- taskhub:begin -->\nhalf\n");
    const r = await run("--claude", join(dir, "BROKEN.md"), "--only", "claude", "--dry-run");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no matching/);
  });
});

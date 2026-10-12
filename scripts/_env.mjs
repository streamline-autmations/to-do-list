// Tiny .env loader (no dependency). Real environment variables always win.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(root = process.cwd()) {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}

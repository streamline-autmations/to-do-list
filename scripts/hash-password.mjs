// Prints a TASKHUB_PASSWORD_HASH for .env.local / Vercel. The password never leaves this machine.
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const N = 65536, r = 8, p = 1;

async function readPassword() {
  if (process.argv[2]) return process.argv[2]; // discouraged: lands in shell history
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  process.stderr.write("Choose a login password (input hidden, 12+ characters): ");
  return await new Promise((resolve) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", function onData(ch) {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 12) {
  console.error("Use at least 12 characters (a few random words is fine).");
  process.exit(1);
}
const salt = randomBytes(16);
const key = await scryptAsync(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
const hash = ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join(".");

console.error("\nAdd this line to .env.local, and the value to your Vercel environment variables:\n");
console.log(`TASKHUB_PASSWORD_HASH=${hash}`);

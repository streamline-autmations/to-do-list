import { describe, expect, it } from "vitest";
import {
  authenticate,
  checkLoginPassword,
  createSessionToken,
  hashPassword,
  safeEqual,
  SESSION_COOKIE,
  verifyPasswordHash,
  verifySessionToken,
} from "../src/lib/auth";
import { TEST_TOKEN } from "./global-setup";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("a long enough passphrase");
    expect(hash.startsWith("scrypt.")).toBe(true);
    expect(await verifyPasswordHash("a long enough passphrase", hash)).toBe(true);
    expect(await verifyPasswordHash("wrong", hash)).toBe(false);
    expect(await verifyPasswordHash("x", "garbage")).toBe(false);
  });
  it("survives .env loaders that expand $VARS", async () => {
    expect(await hashPassword("x")).not.toContain("$");
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("malformed password hashes fail closed", () => {
  const bad = [
    "scrypt.65536.8.1.c2FsdA.!", // decodes to zero bytes: used to match ANY password
    "scrypt.65536.8.1.c2FsdA.", // empty hash
    "scrypt.65536.8.1..", // everything empty
    "scrypt.1.8.1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // N too small / not strong
    "scrypt.65536.8.1.c2FsdA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // salt too short
    "scrypt.65536.8.1.AAAAAAAAAAAAAAAAAAAAAA.AAAA", // hash too short
    "scrypt.65536.8.1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.extra",
    "bcrypt.65536.8.1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "",
  ];
  it.each(bad)("rejects %j for every password", async (stored) => {
    expect(await verifyPasswordHash("anything", stored)).toBe(false);
    expect(await verifyPasswordHash("", stored)).toBe(false);
  });
  it("treats a malformed TASKHUB_PASSWORD_HASH as a configuration error, not a pass", async () => {
    const old = process.env.TASKHUB_PASSWORD_HASH;
    process.env.TASKHUB_PASSWORD_HASH = "scrypt.65536.8.1.c2FsdA.!";
    try {
      await expect(checkLoginPassword("anything")).rejects.toThrow(/not configured/i);
    } finally {
      process.env.TASKHUB_PASSWORD_HASH = old;
    }
  });
});

describe("session tokens", () => {
  it("accepts a fresh token", () => {
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });
  it("rejects expired, tampered and malformed tokens", () => {
    const now = Date.now();
    const token = createSessionToken(now);
    expect(verifySessionToken(token, now + 31 * 86_400_000)).toBe(false);
    const [exp, mac] = token.split(".");
    expect(verifySessionToken(`${Number(exp) + 1000}.${mac}`)).toBe(false);
    expect(verifySessionToken(`${exp}.${mac!.slice(0, -2)}xx`)).toBe(false);
    expect(verifySessionToken("nope")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares without caring about length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("authenticate()", () => {
  const req = (headers: Record<string, string>, method = "GET") =>
    new Request("https://hub.example.com/api/tasks", { method, headers });

  it("accepts the bearer token and rejects a wrong one", () => {
    expect(authenticate(req({ authorization: `Bearer ${TEST_TOKEN}` }))).toBe("token");
    expect(() => authenticate(req({ authorization: "Bearer nope" }))).toThrow(/Invalid API token/);
    expect(() => authenticate(req({}))).toThrow(/Authentication required/);
  });

  it("supports two comma-separated tokens for rotation", () => {
    const old = process.env.TASKHUB_API_TOKEN;
    process.env.TASKHUB_API_TOKEN = `${old},second-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    try {
      expect(authenticate(req({ authorization: "Bearer second-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa" }))).toBe("token");
      expect(authenticate(req({ authorization: `Bearer ${old}` }))).toBe("token");
    } finally {
      process.env.TASKHUB_API_TOKEN = old;
    }
  });

  it("accepts a session cookie for reads, and checks origin on writes", () => {
    const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;
    expect(authenticate(req({ cookie }))).toBe("session");
    expect(() => authenticate(req({ cookie }, "POST"))).toThrow(/Cross-origin/);
    expect(() => authenticate(req({ cookie, origin: "https://evil.example" }, "POST"))).toThrow(/Cross-origin/);
    expect(authenticate(req({ cookie, origin: "https://hub.example.com", host: "hub.example.com" }, "POST"))).toBe("session");
    expect(authenticate(req({ cookie, "sec-fetch-site": "same-origin" }, "DELETE"))).toBe("session");
  });

  it("does not let a bad bearer fall back to a valid cookie", () => {
    const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;
    expect(() => authenticate(req({ cookie, authorization: "Bearer wrong" }))).toThrow();
  });
});

import { assertSameOrigin, clearedCookieHeader, isSecureRequest } from "@/lib/auth";
import { json, publicRoute } from "@/lib/http";

export const POST = publicRoute(async (req) => {
  // A cross-site form POST must not be able to sign you out.
  assertSameOrigin(req);
  return json({ ok: true }, 200, { "Set-Cookie": clearedCookieHeader(isSecureRequest(req)) });
});

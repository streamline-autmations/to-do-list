import {
  checkLoginPassword,
  clientIp,
  createSessionToken,
  isSecureRequest,
  sessionCookieHeader,
} from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { json, publicRoute } from "@/lib/http";
import { clearAttempts, reserveAttempt } from "@/lib/throttle";
import { onlyKeys, readJson } from "@/lib/validate";

export const POST = publicRoute(async (req) => {
  const body = await readJson(req);
  onlyKeys(body, ["password"]);
  const password = typeof body.password === "string" ? body.password : "";

  const ip = clientIp(req);
  await reserveAttempt(ip); // 429 if over the cap; counted before the password is even checked

  if (!password || !(await checkLoginPassword(password))) {
    throw new ApiError(401, "invalid_credentials", "Incorrect password");
  }

  await clearAttempts(ip);
  const token = createSessionToken();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader(token, isSecureRequest(req)) });
});

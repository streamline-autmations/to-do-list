import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

export async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** For server components: send signed-out visitors to the login page. */
export async function requireSession(): Promise<void> {
  if (!(await hasSession())) redirect("/login");
}

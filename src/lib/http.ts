import { authenticate, type AuthKind } from "./auth";
import { ApiError } from "./errors";

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers });

type Ctx<P> = { params: Promise<P> };

/** Wrap a route handler: authentication, consistent error envelope, no stack leaks. */
export function route<P = Record<string, never>>(
  fn: (req: Request, ctx: { params: P; auth: AuthKind }) => Promise<Response | unknown>,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const auth = authenticate(req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      const out = await fn(req, { params, auth });
      return out instanceof Response ? out : json(out);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Same as `route` but without authentication (login / logout only). */
export function publicRoute(fn: (req: Request) => Promise<Response | unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      const out = await fn(req);
      return out instanceof Response ? out : json(out);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message } }, err.status);
  }
  console.error("[taskhub] unhandled error", err);
  return json({ error: { code: "internal_error", message: "Something went wrong on the server" } }, 500);
}

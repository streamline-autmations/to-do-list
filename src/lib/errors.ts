/** An error that maps to a specific HTTP response. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, code = "invalid_request") => new ApiError(400, code, message);
export const unauthorized = (message = "Authentication required") => new ApiError(401, "unauthorized", message);
export const forbidden = (message: string) => new ApiError(403, "forbidden", message);
export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const conflict = (message: string, code = "conflict") => new ApiError(409, code, message);
export const tooMany = (message: string) => new ApiError(429, "too_many_attempts", message);

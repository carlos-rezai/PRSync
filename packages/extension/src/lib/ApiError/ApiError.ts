// A typed failure from the PRSync API. It carries the HTTP `status` and
// the service's machine `code` (e.g. `ROUND_NOT_OPEN`, `NOT_A_REVIEWER`)
// so a caller can hand the pair to `mapApiError` and act on the returned
// recovery discriminant. `code` is `null` when the response carried no
// recognizable error body.
//
// It lives in `lib/` rather than beside the client that throws it because
// it is a dependency-free value type, and it belongs next to the
// `mapApiError` that interprets it. The layering matters as well as the
// tidiness: `lib` is the leaf layer and must never import `api`, so any
// pure policy over an API failure — `withSingleRetry`, for one — can only
// live here if the error type does too.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(
      `API request failed with status ${status}${code ? ` (${code})` : ""}`
    );
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

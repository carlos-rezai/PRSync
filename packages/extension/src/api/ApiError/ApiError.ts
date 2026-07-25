// A typed failure from the PRSync API client. It carries the HTTP
// `status` and the service's machine `code` (e.g. `ROUND_NOT_OPEN`,
// `NOT_A_REVIEWER`) so the `App` can hand the pair to `mapApiError` and
// act on the returned recovery discriminant. `code` is `null` when the
// response carried no recognizable error body.
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

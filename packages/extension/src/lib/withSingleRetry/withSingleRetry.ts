import { ApiError } from "../ApiError/ApiError";
import { mapApiError } from "../mapApiError/mapApiError";

// The panel's retry policy, as a pure function over a promise-returning
// call. It is `lib`'s to own for the same reason `mapApiError` is: it
// turns a failure into a decision, and holds no state of its own.

/**
 * Runs a mutation, auto-retrying EXACTLY once when the API reports a
 * transient write conflict (`503 CONCURRENCY_EXHAUSTED`, which
 * `mapApiError` classes as `retry`). Momentary contention is then
 * invisible to the viewer; a second failure propagates so the caller can
 * surface the guidance a spent retry leaves behind — try again yourself.
 *
 * Nothing else is ever re-sent. A `401`, for one, can only fail again, and
 * a re-sent round-open would snapshot a reviewer list that had moved.
 */
export async function withSingleRetry<T>(
  mutation: () => Promise<T>
): Promise<T> {
  try {
    return await mutation();
  } catch (error) {
    const transient =
      error instanceof ApiError &&
      mapApiError(error.status, error.code).recovery === "retry";
    if (!transient) {
      throw error;
    }
    return mutation();
  }
}

import type { Round } from "../../lib";
import { ApiError } from "../ApiError/ApiError";

// The PRSync API client. Phase 2 adds the own-row Done toggle to the
// Phase 1 current-round read; later phases (open, edit-label, cancel)
// extend it further. Every call carries the caller's ADO bearer token,
// obtained via the injected token getter, and rejects with an `ApiError`
// (status + service code) so `mapApiError` can route the recovery.

export interface ApiClient {
  /**
   * GET the PR's current round. Resolves to the `Round` on `200`, or
   * `null` on `204` (no round yet). Rejects on any other status.
   */
  getCurrentRound(prKey: string): Promise<Round | null>;

  /**
   * PATCH the caller's own Done state on an open round. Carries no
   * reviewer id — the API targets the authenticated caller. Resolves to
   * the authoritative `Round` the service returns (which may be `closed`
   * if this toggle met quorum). Rejects with an `ApiError`.
   */
  toggleDone(prKey: string, roundNumber: number, done: boolean): Promise<Round>;
}

/** Reads the service's machine error `code` from a non-OK JSON body. */
async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * Constructs the real fetch-backed API client against a deployed
 * Function App. `getAccessToken` is the SDK seam's token getter.
 */
export function createApiClient(
  baseUrl: string,
  getAccessToken: () => Promise<string>
): ApiClient {
  return {
    async getCurrentRound(prKey) {
      const token = await getAccessToken();
      const response = await fetch(
        `${baseUrl}/api/prs/${encodeURIComponent(prKey)}/rounds/current`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.status === 204) {
        return null;
      }
      if (!response.ok) {
        throw new ApiError(response.status, await readErrorCode(response));
      }
      return (await response.json()) as Round;
    },

    async toggleDone(prKey, roundNumber, done) {
      const token = await getAccessToken();
      const response = await fetch(
        `${baseUrl}/api/prs/${encodeURIComponent(prKey)}/rounds/${roundNumber}/done`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ done }),
        }
      );
      if (!response.ok) {
        throw new ApiError(response.status, await readErrorCode(response));
      }
      return (await response.json()) as Round;
    },
  };
}

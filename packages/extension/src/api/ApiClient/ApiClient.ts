import type { Round } from "../../lib";

// The PRSync API client. Phase 1 needs exactly one route — the current
// round read — so that is all this interface declares; later phases
// (done-toggle, open, edit-label, cancel) extend it. Every call carries
// the caller's ADO bearer token, obtained via the injected token getter.

export interface ApiClient {
  /**
   * GET the PR's current round. Resolves to the `Round` on `200`, or
   * `null` on `204` (no round yet). Rejects on any other status.
   */
  getCurrentRound(prKey: string): Promise<Round | null>;
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
        throw new Error(
          `getCurrentRound failed with status ${response.status}`
        );
      }
      return (await response.json()) as Round;
    },
  };
}

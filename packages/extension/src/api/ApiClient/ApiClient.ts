import { ApiError } from "../../lib";
import type { Round } from "../../lib";
import type { AdoReviewer } from "../../ado";

// The PRSync API client. Phase 4 completes the round's write surface —
// the Phase 1 current-round read, the Phase 2 own-row Done toggle, the
// Phase 3 round-open, and the author's two management actions here. Every
// call carries the caller's ADO bearer token, obtained via the injected
// token getter, and rejects with an `ApiError` (status + service code) so
// `mapApiError` can route the recovery.

/**
 * The body of `POST /api/prs/{prKey}/rounds` — a snapshot of ADO's live
 * PR read at the instant the author clicked "Ready for review". `author`
 * is display/Teams data only (the API records the authenticated caller as
 * the author), and `label` is OMITTED when the author left the pre-filled
 * default untouched, so the API generates it canonically.
 */
export interface OpenRoundRequest {
  phase: Round["phase"];
  reviewers: AdoReviewer[];
  prTitle: string;
  prUrl: string;
  author: { name: string; email: string };
  label?: string;
}

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

  /**
   * POST the next round on the PR, carrying the reviewer/title/url
   * snapshot read from ADO at the moment the author clicked. Resolves to
   * the newly opened `Round`. Rejects with an `ApiError` — notably `422`
   * `INSUFFICIENT_REVIEWERS`, the server-owned gate on the snapshot.
   */
  openRound(prKey: string, request: OpenRoundRequest): Promise<Round>;

  /**
   * PATCH an open round's label with the author's exact text. Resolves to
   * the authoritative `Round` the service returns — the stored wording
   * wins over what the author typed. Rejects with an `ApiError`.
   */
  editLabel(prKey: string, roundNumber: number, label: string): Promise<Round>;

  /**
   * POST the silent abandonment of an open round: it becomes `cancelled`
   * and, unlike a real close, fires no Teams DM. Resolves to the
   * cancelled `Round`. Rejects with an `ApiError`.
   */
  cancelRound(prKey: string, roundNumber: number): Promise<Round>;
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
  /**
   * Everything the five calls have in common: the caller's bearer token,
   * the JSON content type when there is something to send, and the
   * non-OK-to-`ApiError` translation. Resolves to the raw `Response` so
   * the one call that cares about a `204` can still see it.
   */
  async function send(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers,
      // An untouched compose label is `undefined` and drops out of the
      // JSON here, leaving the API to generate the canonical wording.
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      throw new ApiError(response.status, await readErrorCode(response));
    }
    return response;
  }

  /**
   * The single point where an API response becomes a `Round`. Every call
   * that returns one goes through here, so the assertion the wire forces
   * on us lives in exactly one place rather than five.
   */
  async function readRound(response: Response): Promise<Round> {
    return (await response.json()) as Round;
  }

  /** The PR's round collection, with the key encoded into the segment. */
  function rounds(prKey: string): string {
    return `/api/prs/${encodeURIComponent(prKey)}/rounds`;
  }

  return {
    async getCurrentRound(prKey) {
      const response = await send(`${rounds(prKey)}/current`);
      // The one call with a meaningful empty success: `204` is "this PR
      // has never had a round", which is a state, not a failure.
      return response.status === 204 ? null : readRound(response);
    },

    async toggleDone(prKey, roundNumber, done) {
      return readRound(
        await send(`${rounds(prKey)}/${roundNumber}/done`, {
          method: "PATCH",
          body: { done },
        })
      );
    },

    async openRound(prKey, request) {
      return readRound(
        await send(rounds(prKey), { method: "POST", body: request })
      );
    },

    async editLabel(prKey, roundNumber, label) {
      return readRound(
        await send(`${rounds(prKey)}/${roundNumber}`, {
          method: "PATCH",
          body: { label },
        })
      );
    },

    async cancelRound(prKey, roundNumber) {
      // No body: the round number in the path is the whole request, so no
      // `Content-Type` goes out either.
      return readRound(
        await send(`${rounds(prKey)}/${roundNumber}/cancel`, {
          method: "POST",
        })
      );
    },
  };
}

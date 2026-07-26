// The panel's single, pure translation from an API failure
// ({ status, code }) to viewer-facing guidance ({ message, recovery }).
// `recovery` is the behavioural contract — it tells the `App` what to DO;
// `message` is what the viewer reads. Confirmed against Feature 1's
// RoundService error codes (docs/PRDs/02-extension-panel.md "Error
// mapping"). Terminology: docs/ubiquitous-language.md.

/**
 * What the `App` should do in response to a failure:
 * - `reload` — the session is gone; the fix is a full page reload.
 * - `refetch` — the client drifted from the true state; re-read the round
 *   to self-heal, then surface the reconciled state.
 * - `retry` — a transient conflict; try the same call once more.
 * - `inline` — show the message next to the control; no automatic action.
 */
export type Recovery = "reload" | "refetch" | "retry" | "inline";

export interface ErrorGuidance {
  message: string;
  recovery: Recovery;
}

export function mapApiError(
  status: number,
  code: string | null
): ErrorGuidance {
  switch (status) {
    case 401:
      return {
        recovery: "reload",
        message: "Your session expired. Refresh the page to sign back in.",
      };
    // Drift class: the UI should rarely allow these, so a re-fetch quietly
    // reconciles the client to the true state (ROUND_NOT_OPEN /
    // ROUND_ALREADY_OPEN / NOT_A_REVIEWER / NOT_AUTHOR).
    case 403:
    case 409:
      return {
        recovery: "refetch",
        message: "This round changed since you last loaded it. Refreshing…",
      };
    case 422:
      return {
        recovery: "inline",
        message:
          code === "INSUFFICIENT_REVIEWERS"
            ? "This round needs an eligible reviewer in ADO before it can open."
            : "That change wasn't valid.",
      };
    // The App auto-retries a `503` exactly once, so the message a viewer
    // actually reads is the post-retry one: by then the retry is spent and
    // the next attempt is theirs to make.
    case 503:
      return {
        recovery: "retry",
        message: "The service is busy right now. Please try again.",
      };
    default:
      return {
        recovery: "inline",
        message: "Something went wrong. Please try again.",
      };
  }
}

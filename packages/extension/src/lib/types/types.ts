// Domain types shared by the panel, mirrored from packages/api's
// core round types (packages/api/src/lib/types/types.ts) so the panel
// reads exactly what the API returns. Terminology follows
// docs/ubiquitous-language.md — read it before renaming anything here.

/** Which content a round reviews. Set at open, frozen thereafter. */
export type Phase = "spec" | "implementation";

/** A round's lifecycle state. `open` is live; the others are terminal. */
export type RoundStatus = "open" | "closed" | "cancelled";

/**
 * A tracked reviewer frozen into a round at open time — the snapshot the
 * panel renders. `teamsIdOverride` is reserved for future manual
 * ADO↔Teams mapping (unused in v1).
 */
export interface RoundReviewer {
  adoId: string;
  email: string;
  displayName: string;
  isRequired: boolean;
  done: boolean;
  doneAt?: string;
  teamsIdOverride: string | null;
}

/**
 * A single round of review on a PR, as returned by the PRSync API. The
 * panel is a near-pure function of one of these.
 */
export interface Round {
  prKey: string;
  roundNumber: number;
  phase: Phase;
  label: string;
  status: RoundStatus;
  quorum: number;
  reviewers: RoundReviewer[];
  prTitle: string;
  prUrl: string;
  authorAdoId: string;
  authorName: string;
  authorEmail: string;
  openedAt: string;
  closedAt?: string;
  cancelledAt?: string;
  schemaVersion: number;
}

/**
 * The viewer's role, derived locally for presentation only (which
 * read-only view to show) — never trusted for authorization. See
 * docs/ubiquitous-language.md ("Author", "Reviewer", "Bystander").
 */
export type Role = "author" | "reviewer" | "bystander";

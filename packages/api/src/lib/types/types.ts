// Core domain types for the round lifecycle. Terminology follows
// docs/ubiquitous-language.md exactly — read it before renaming
// anything here.

/** Which content a round reviews. Set at open, frozen thereafter. */
export type Phase = "spec" | "implementation";

/** A round's lifecycle state. `open` is live; the others are terminal. */
export type RoundStatus = "open" | "closed" | "cancelled";

/**
 * A reviewer as sent by the client from ADO's live reviewer list at
 * open time. `isContainer` marks teams/groups, which are never tracked.
 * This is the raw input to the snapshot filter, not what we persist.
 */
export interface IncomingReviewer {
  adoId: string;
  email: string;
  displayName: string;
  isRequired: boolean;
  isContainer: boolean;
}

/**
 * A tracked reviewer frozen into a round at open time. `teamsIdOverride`
 * is reserved for future manual ADO↔Teams mapping (unused in v1).
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

/** The person who owns the PR and opens/cancels its rounds. */
export interface Author {
  adoId: string;
  name: string;
  email: string;
}

/**
 * A single round of review on a PR — one Table Storage entity,
 * partitioned by PR key. `doneCount`, quorum-met, and the gating set
 * are derived at read time, never stored.
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

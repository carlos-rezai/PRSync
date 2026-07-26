import type { Round, RoundReviewer } from "../types/types";

// The panel's drift model. Feature 1's `Round` carries no etag or
// `updatedAt`, so the panel derives its own digest of a round's SALIENT
// lifecycle fields and compares it against the viewer's baseline — the
// last authoritative state they saw or acted on. A mismatch is Drift and
// raises the refresh banner; equality is silence (PRD #7 "Drift
// detection"). Terminology: docs/ubiquitous-language.md.
//
// The salient set is exactly five things: `roundNumber`, `status`,
// `phase`, `label`, and each reviewer's `done`. Everything else on a round
// is presentation or provenance and must not move the fingerprint, or the
// viewer gets a refresh banner for nothing.
//
// The digest format itself is private — callers only ever compare two
// fingerprints to each other.

/** Orders reviewers by ADO id so a reordered list is never read as Drift. */
function byAdoId(left: RoundReviewer, right: RoundReviewer): number {
  if (left.adoId === right.adoId) {
    return 0;
  }
  return left.adoId < right.adoId ? -1 : 1;
}

/**
 * Digests the salient lifecycle state of a round — or of the absence of
 * one, which is a baseline the viewer can hold just as well: it stays
 * quiet while there is still no round, and registers as Drift the moment
 * the author opens one.
 */
export function roundFingerprint(round: Round | null): string {
  if (round === null) {
    return JSON.stringify(null);
  }
  return JSON.stringify({
    roundNumber: round.roundNumber,
    status: round.status,
    phase: round.phase,
    label: round.label,
    // A copy, so digesting a round never reorders the caller's list.
    reviewers: [...round.reviewers]
      .sort(byAdoId)
      .map((reviewer) => [reviewer.adoId, reviewer.done]),
  });
}

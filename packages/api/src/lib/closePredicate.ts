import type { Round, RoundReviewer } from "./types/types";

// Pure close predicate. A round closes the instant the Done count over
// the *gating set* reaches the quorum AND every required reviewer is
// Done. The gating set is the required reviewers whenever any reviewer
// is required, else every tracked individual (containers and the author
// were already dropped at snapshot time). Optional reviewers are tracked
// but never gate. Nothing here is stored — it is derived at read time.

export function gatingSet(reviewers: RoundReviewer[]): RoundReviewer[] {
  const required = reviewers.filter((r) => r.isRequired);
  return required.length > 0 ? required : reviewers;
}

export function isCloseReached(round: Round): boolean {
  const gating = gatingSet(round.reviewers);
  const doneCount = gating.filter((r) => r.done).length;
  const allRequiredDone = round.reviewers
    .filter((r) => r.isRequired)
    .every((r) => r.done);
  return doneCount >= round.quorum && allRequiredDone;
}

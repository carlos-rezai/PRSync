// The client-side pre-check gate for "Ready for review": does the fresh
// ADO snapshot contain at least one reviewer whose Done state could count
// toward close? It mirrors the API's snapshotReviewers filter
// (packages/api/src/lib/reviewerSnapshot) — real, non-container
// individuals excluding the author — so the panel disables the button for
// exactly the lists the server would reject with a `422`. That `422` stays
// the authoritative backstop; this is only a courtesy gate. See
// docs/ubiquitous-language.md ("Gating set", "Reviewer").

/** The slice of a live ADO reviewer the eligibility gate reads. */
export interface EligibilityCandidate {
  adoId: string;
  isContainer: boolean;
}

export function hasEligibleReviewers(
  reviewers: readonly EligibilityCandidate[],
  authorAdoId: string
): boolean {
  return reviewers.some(
    (reviewer) => !reviewer.isContainer && reviewer.adoId !== authorAdoId
  );
}

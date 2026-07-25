import type { Round, Role } from "../types/types";

// Derives the viewer's role for presentation only (which read-only view
// to show); it is never trusted for authorization. See
// docs/ubiquitous-language.md ("Author", "Reviewer", "Bystander").
//
// Round present  → author = round.authorAdoId; reviewer = a match in
//                  round.reviewers; otherwise bystander.
// No round (204) → author = ADO createdBy; otherwise bystander.
export function deriveRole(
  viewerAdoId: string,
  round: Round | null,
  createdByAdoId: string | null
): Role {
  if (round) {
    if (viewerAdoId === round.authorAdoId) {
      return "author";
    }
    if (round.reviewers.some((reviewer) => reviewer.adoId === viewerAdoId)) {
      return "reviewer";
    }
    return "bystander";
  }
  if (createdByAdoId !== null && viewerAdoId === createdByAdoId) {
    return "author";
  }
  return "bystander";
}

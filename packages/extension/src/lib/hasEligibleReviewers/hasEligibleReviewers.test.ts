import { describe, it, expect } from "vitest";
import { hasEligibleReviewers } from "./hasEligibleReviewers";

// The client-side pre-check gate for "Ready for review": does the fresh
// ADO snapshot contain at least one reviewer whose Done state could count
// toward close? It mirrors the API's snapshotReviewers filter byte-for-
// byte — real, non-container individuals excluding the author — so the
// panel disables the button for exactly the lists the server would reject.
// The server's 422 stays the authoritative backstop. Terminology:
// docs/ubiquitous-language.md ("Gating set", "Reviewer").

const AUTHOR_ID = "author-guid-0000-0000-0000-000000000001";
const REVIEWER_ID = "reviewer-guid-0000-0000-0000-00000000002";

describe("hasEligibleReviewers", () => {
  it("is true when a non-container individual other than the author is present", () => {
    expect(
      hasEligibleReviewers(
        [{ adoId: REVIEWER_ID, isContainer: false }],
        AUTHOR_ID
      )
    ).toBe(true);
  });

  it("is false for an empty reviewer list", () => {
    expect(hasEligibleReviewers([], AUTHOR_ID)).toBe(false);
  });

  it("is false when every reviewer is a container (team/group)", () => {
    expect(
      hasEligibleReviewers(
        [
          { adoId: "team-1", isContainer: true },
          { adoId: "team-2", isContainer: true },
        ],
        AUTHOR_ID
      )
    ).toBe(false);
  });

  it("is false when the only individual is the author", () => {
    expect(
      hasEligibleReviewers(
        [{ adoId: AUTHOR_ID, isContainer: false }],
        AUTHOR_ID
      )
    ).toBe(false);
  });

  it("counts only the eligible reviewer amid a container and the author", () => {
    expect(
      hasEligibleReviewers(
        [
          { adoId: "team-1", isContainer: true },
          { adoId: AUTHOR_ID, isContainer: false },
          { adoId: REVIEWER_ID, isContainer: false },
        ],
        AUTHOR_ID
      )
    ).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { deriveRole } from "./deriveRole";
import type { Round, RoundReviewer } from "../types/types";

// The viewer's role is derived for presentation only (which read-only
// view to show); it is never trusted for authorization. Terminology:
// docs/ubiquitous-language.md ("Author", "Reviewer", "Bystander").
//
// Round present  → author = round.authorAdoId; reviewer = a match in
//                  round.reviewers; otherwise bystander.
// No round (204) → author = ADO createdBy; otherwise bystander.

const AUTHOR_ID = "author-guid-0000-0000-0000-000000000001";
const REVIEWER_ID = "reviewer-guid-0000-0000-0000-00000000002";
const STRANGER_ID = "stranger-guid-0000-0000-0000-00000000003";

function makeReviewer(adoId: string): RoundReviewer {
  return {
    adoId,
    email: `${adoId}@example.com`,
    displayName: adoId,
    isRequired: true,
    done: false,
    teamsIdOverride: null,
  };
}

function makeRound(): Round {
  return {
    prKey: "p:r:1",
    roundNumber: 1,
    phase: "spec",
    label: "Round 1 — Spec Review",
    status: "open",
    quorum: 2,
    reviewers: [makeReviewer(REVIEWER_ID)],
    prTitle: "Some PR",
    prUrl: "https://example.com/pr/1",
    authorAdoId: AUTHOR_ID,
    authorName: "The Author",
    authorEmail: "author@example.com",
    openedAt: "2026-07-25T00:00:00.000Z",
    schemaVersion: 1,
  };
}

describe("deriveRole", () => {
  describe("with a current round", () => {
    it("returns 'author' when the viewer is the round's author", () => {
      expect(deriveRole(AUTHOR_ID, makeRound(), null)).toBe("author");
    });

    it("returns 'reviewer' when the viewer is in the snapshotted reviewer list", () => {
      expect(deriveRole(REVIEWER_ID, makeRound(), null)).toBe("reviewer");
    });

    it("returns 'bystander' when the viewer is neither author nor reviewer", () => {
      expect(deriveRole(STRANGER_ID, makeRound(), null)).toBe("bystander");
    });
  });

  describe("with no round (204 — falls back to ADO createdBy)", () => {
    it("returns 'author' when the viewer is the PR's createdBy", () => {
      expect(deriveRole(AUTHOR_ID, null, AUTHOR_ID)).toBe("author");
    });

    it("returns 'bystander' when the viewer did not create the PR", () => {
      expect(deriveRole(STRANGER_ID, null, AUTHOR_ID)).toBe("bystander");
    });
  });
});

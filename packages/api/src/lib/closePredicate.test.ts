import { describe, it, expect } from "vitest";
import { gatingSet, isCloseReached } from "./closePredicate";
import type { Round, RoundReviewer } from "./types";

// Pure predicate tests. The gating set is the required reviewers when any
// are required, else every tracked individual (containers and the author
// were already dropped at snapshot time). A round is closed the instant
// the Done count over the gating set reaches the quorum AND every required
// reviewer is done. Optional reviewers are tracked but never gate.

function reviewer(overrides: Partial<RoundReviewer> = {}): RoundReviewer {
  return {
    adoId: "r",
    email: "r@example.com",
    displayName: "R",
    isRequired: false,
    done: false,
    teamsIdOverride: null,
    ...overrides,
  };
}

function roundWith(reviewers: RoundReviewer[], quorum: number): Round {
  return {
    prKey:
      "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42",
    roundNumber: 1,
    phase: "implementation",
    label: "Round 1 — Implementation Review",
    status: "open",
    quorum,
    reviewers,
    prTitle: "t",
    prUrl: "u",
    authorAdoId: "author",
    authorName: "A",
    authorEmail: "a@example.com",
    openedAt: "2026-07-24T09:00:00.000Z",
    schemaVersion: 1,
  };
}

describe("gatingSet", () => {
  it("is every tracked reviewer when none are required", () => {
    const rs = [reviewer({ adoId: "r1" }), reviewer({ adoId: "r2" })];
    expect(gatingSet(rs).map((r) => r.adoId)).toEqual(["r1", "r2"]);
  });

  it("is only the required reviewers when some are required", () => {
    const rs = [
      reviewer({ adoId: "req", isRequired: true }),
      reviewer({ adoId: "opt", isRequired: false }),
    ];
    expect(gatingSet(rs).map((r) => r.adoId)).toEqual(["req"]);
  });

  it("is empty for an empty reviewer list", () => {
    expect(gatingSet([])).toEqual([]);
  });
});

describe("isCloseReached", () => {
  it("is false while the Done count is below the quorum", () => {
    const round = roundWith(
      [reviewer({ adoId: "r1", done: true }), reviewer({ adoId: "r2" })],
      2
    );
    expect(isCloseReached(round)).toBe(false);
  });

  it("is true once the Done count meets the quorum and no reviewer is required", () => {
    const round = roundWith(
      [
        reviewer({ adoId: "r1", done: true }),
        reviewer({ adoId: "r2", done: true }),
        reviewer({ adoId: "r3" }),
      ],
      2
    );
    expect(isCloseReached(round)).toBe(true);
  });

  it("does not count optional reviewers toward the quorum when required reviewers gate", () => {
    // Two required reviewers gate; quorum 2. An optional reviewer being Done
    // must not push the count to quorum — only the gating set counts.
    const round = roundWith(
      [
        reviewer({ adoId: "req1", isRequired: true, done: true }),
        reviewer({ adoId: "req2", isRequired: true, done: false }),
        reviewer({ adoId: "opt", isRequired: false, done: true }),
      ],
      2
    );
    expect(isCloseReached(round)).toBe(false);
  });

  it("stays open until every required reviewer is Done even if the count reaches quorum", () => {
    // 3 required, quorum 2: two Done meets the count, but the third required
    // is not Done — the required clause keeps the round open.
    const round = roundWith(
      [
        reviewer({ adoId: "req1", isRequired: true, done: true }),
        reviewer({ adoId: "req2", isRequired: true, done: true }),
        reviewer({ adoId: "req3", isRequired: true, done: false }),
      ],
      2
    );
    expect(isCloseReached(round)).toBe(false);
  });

  it("closes when the quorum is met and all required reviewers are Done", () => {
    const round = roundWith(
      [
        reviewer({ adoId: "req1", isRequired: true, done: true }),
        reviewer({ adoId: "req2", isRequired: true, done: true }),
      ],
      2
    );
    expect(isCloseReached(round)).toBe(true);
  });
});

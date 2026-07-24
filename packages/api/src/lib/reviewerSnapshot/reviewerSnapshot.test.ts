import { describe, it, expect } from "vitest";
import { snapshotReviewers } from "./reviewerSnapshot";
import type { IncomingReviewer } from "../types/types";

// The reviewer list is copied from ADO at open time and frozen. Only
// real, non-author individuals are tracked: containers (teams/groups)
// and the author are dropped at snapshot time. Each survivor starts
// `done: false` with the reserved `teamsIdOverride` nulled out.

const AUTHOR = "author-ado-id";

function incoming(overrides: Partial<IncomingReviewer> = {}): IncomingReviewer {
  return {
    adoId: "reviewer-1",
    email: "r1@example.com",
    displayName: "Reviewer One",
    isRequired: false,
    isContainer: false,
    ...overrides,
  };
}

describe("snapshotReviewers", () => {
  it("keeps real, non-author individuals", () => {
    const result = snapshotReviewers(
      [incoming({ adoId: "r1" }), incoming({ adoId: "r2", isRequired: true })],
      AUTHOR
    );
    expect(result.map((r) => r.adoId)).toEqual(["r1", "r2"]);
  });

  it("drops containers (teams/groups)", () => {
    const result = snapshotReviewers(
      [
        incoming({ adoId: "r1" }),
        incoming({ adoId: "team", isContainer: true }),
      ],
      AUTHOR
    );
    expect(result.map((r) => r.adoId)).toEqual(["r1"]);
  });

  it("drops the author even if ADO lists them as a reviewer", () => {
    const result = snapshotReviewers(
      [incoming({ adoId: "r1" }), incoming({ adoId: AUTHOR })],
      AUTHOR
    );
    expect(result.map((r) => r.adoId)).toEqual(["r1"]);
  });

  it("initializes each tracked reviewer as not-done with a reserved teamsIdOverride", () => {
    const [reviewer] = snapshotReviewers([incoming({ adoId: "r1" })], AUTHOR);
    expect(reviewer).toMatchObject({
      adoId: "r1",
      email: "r1@example.com",
      displayName: "Reviewer One",
      isRequired: false,
      done: false,
      teamsIdOverride: null,
    });
    expect(reviewer?.doneAt).toBeUndefined();
  });

  it("returns an empty list when nobody survives filtering", () => {
    expect(
      snapshotReviewers(
        [
          incoming({ adoId: "team", isContainer: true }),
          incoming({ adoId: AUTHOR }),
        ],
        AUTHOR
      )
    ).toEqual([]);
  });
});

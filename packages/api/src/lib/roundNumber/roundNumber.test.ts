import { describe, it, expect } from "vitest";
import { deriveNextRoundNumber } from "./roundNumber";

// Round numbers are server-derived so an author can never create a
// duplicate or out-of-order round. The next number is `lastRound + 1`,
// or 1 when the PR has never had a round. Status of the predecessor is
// irrelevant here — the caller passes whatever the latest round number
// is; that it may be closed or cancelled is decided upstream.

describe("deriveNextRoundNumber", () => {
  it("is 1 when there is no prior round", () => {
    expect(deriveNextRoundNumber(null)).toBe(1);
  });

  it("increments the latest round number by one", () => {
    expect(deriveNextRoundNumber(1)).toBe(2);
    expect(deriveNextRoundNumber(7)).toBe(8);
  });
});

import { describe, it, expect } from "vitest";
import { generateLabel } from "./label";

// The auto-generated round label reviewers see when the author does not
// type one. Format follows the ubiquitous-language example exactly:
// "Round 2 — Implementation Review" (em dash, title-cased phase).

describe("generateLabel", () => {
  it("names a spec-phase round", () => {
    expect(generateLabel(1, "spec")).toBe("Round 1 — Spec Review");
  });

  it("names an implementation-phase round", () => {
    expect(generateLabel(2, "implementation")).toBe(
      "Round 2 — Implementation Review"
    );
  });

  it("uses the round number verbatim for multi-digit rounds", () => {
    expect(generateLabel(10, "spec")).toBe("Round 10 — Spec Review");
  });
});

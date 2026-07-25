import { describe, it, expect } from "vitest";
import { deriveDefaultLabel } from "./deriveDefaultLabel";

// The canonical round label the panel pre-fills in the compose form.
// Must reproduce the API's generateLabel format byte-for-byte so the
// panel and DB never diverge on wording (em dash, title-cased phase).
// See docs/ubiquitous-language.md ("Round label") and
// packages/api/src/lib/label.

describe("deriveDefaultLabel", () => {
  it("names a spec-phase round", () => {
    expect(deriveDefaultLabel(1, "spec")).toBe("Round 1 — Spec Review");
  });

  it("names an implementation-phase round", () => {
    expect(deriveDefaultLabel(2, "implementation")).toBe(
      "Round 2 — Implementation Review"
    );
  });

  it("uses the round number verbatim for multi-digit rounds", () => {
    expect(deriveDefaultLabel(10, "spec")).toBe("Round 10 — Spec Review");
  });
});

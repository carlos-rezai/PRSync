import { describe, it, expect } from "vitest";
import { boldedTerms } from "./boldedTerms";

// Lifted out of the spec file, where it had never had a test of its own.
// The wrapped-span rule its doc comment describes is the whole reason it
// is not a one-line regex, and it was going unasserted.

describe("boldedTerms", () => {
  it("finds each bolded span, in order", () => {
    expect(boldedTerms("**Round** opens, then **Quorum** closes it.")).toEqual([
      "Round",
      "Quorum",
    ]);
  });

  it("reads a span the formatter wrapped as one term", () => {
    // `proseWrap` is `preserve` and these documents are hand-wrapped at 80
    // columns, so a two-word term lands across a line break routinely.
    expect(boldedTerms("The **Round\nclosed** state is terminal.")).toEqual([
      "Round closed",
    ]);
  });

  it("does not pair one term's closing stars with the next term's opening ones", () => {
    // The failure the wrapped-span rule exists to prevent, and the reason
    // matching line-by-line is wrong: read a line at a time, the wrapped
    // term's `**` closes against `**Done**`'s opener and the prose between
    // them gets reported as an unknown term.
    expect(
      boldedTerms("A **Round\nclosed** by quorum, then **Done** per reviewer.")
    ).toEqual(["Round closed", "Done"]);
  });

  it("collapses runs of whitespace inside a term", () => {
    expect(boldedTerms("**Ready   for\n  review**")).toEqual([
      "Ready for review",
    ]);
  });

  it("reports each term once, however often it is bolded", () => {
    // The gloss section names its terms in a heading and again in the
    // prose under it; a duplicate would be checked twice and reported
    // twice for the same drift.
    expect(boldedTerms("**Done** ... **Done** again")).toEqual(["Done"]);
  });

  it("finds nothing in markdown that bolds nothing", () => {
    // The vacuous case, which the caller's floor turns into a failure:
    // the gloss section is named for five words, so an extractor that
    // silently finds none must not be able to pass quietly.
    expect(boldedTerms("# Heading\n\nPlain prose.")).toEqual([]);
  });
});

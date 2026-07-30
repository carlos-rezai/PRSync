import { describe, it, expect } from "vitest";
import { settingTokens, stageNumbers } from "../lib";
import { readDocument } from "../repo";
import { at, LAST_STAGE, SETUP_GUIDE } from "./documents";

// `docs/setup-guide.md` owns SEQUENCE — the order the stages happen in,
// and nothing else. Two things rot in a document with that job:
//
//   1. a stage silently deleted or reordered leaves a sequence that still
//      READS as a sequence. The order is the document's entire content,
//      and eleven stages that skip one are worse than none;
//   2. a setting NAME appearing here is the no-duplication rule breaking.
//      `docs/deployment.md` owns setting values. Two documents that both
//      describe configuration is the state the split exists to leave
//      behind, and the copy is always the one that goes stale.
//
// Both assertions are STRUCTURAL, and it is worth being plain about what
// that costs. The first proves twelve headings exist in ascending order
// and nothing whatsoever about what is under them — a stage emptied to a
// single word still passes. The second catches a setting NAME, which is
// the mechanically recognisable half of the ownership rule; a value
// described in prose without naming its setting passes, and only a human
// read catches that.

describe("the setup guide's stages", () => {
  it("carries every numbered stage, in ascending order", () => {
    // The guide owns sequence and nothing else, so a missing or reordered
    // stage is not a formatting problem — it is the document's content
    // being wrong.
    const guide = readDocument(at(SETUP_GUIDE), SETUP_GUIDE);
    const stages = stageNumbers(guide);

    const expected = Array.from({ length: LAST_STAGE + 1 }, (_, i) => i);

    expect(
      stages,
      `${SETUP_GUIDE} declares stages ${stages.join(", ")}; it is contracted to carry 0 through ${LAST_STAGE}, once each, in order`
    ).toEqual(expected);
  });
});

describe("the setup guide's ownership", () => {
  it("names no setting outside a link", () => {
    // `docs/deployment.md` owns setting values; this guide owns order. A
    // setting named here is a second copy of a table that already exists,
    // and the copy is the one that goes stale — which is the whole reason
    // the two documents were split.
    //
    // The allowance that makes this followable rather than a ban on ever
    // mentioning configuration — a LINKED setting passes — is pinned in
    // `lib/settingTokens`'s own test, where it is a fact about the
    // function rather than about this document.
    const guide = readDocument(at(SETUP_GUIDE), SETUP_GUIDE);
    const hits = settingTokens(guide);

    expect(
      hits.map(({ token, line, text }) => `${token} — line ${line}: ${text}`),
      `${SETUP_GUIDE} names settings docs/deployment.md owns; it should link to them instead`
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { stageNumbers } from "./stages";

describe("stageNumbers", () => {
  it("reads each stage number, at any heading depth", () => {
    expect(
      stageNumbers(
        [
          "# PRSync — Setup guide",
          "## Stage 0 — Before you start",
          "### Stage 1 — Storage",
          "## Stage 2 — The API",
        ].join("\n")
      )
    ).toEqual([0, 1, 2]);
  });

  it("keeps the order they are written in, unsorted", () => {
    // The property the caller depends on. Sorting here would turn "stage 7
    // is written after stage 8" — a real defect in a document whose entire
    // content is sequence — into a pass.
    expect(stageNumbers("## Stage 2 — B\n## Stage 1 — A")).toEqual([2, 1]);
  });

  it("keeps a repeated stage number, so a duplicate is visible", () => {
    expect(stageNumbers("## Stage 1 — A\n## Stage 1 — Again")).toEqual([1, 1]);
  });

  it("reads a multi-digit stage as one number", () => {
    // The guide runs to stage 11, so this is the live case rather than a
    // hypothetical: a reader that took one digit would report stage 1.
    expect(stageNumbers("## Stage 11 — Verifying the round trip")).toEqual([
      11,
    ]);
  });

  it("ignores a mention of a stage that is not a heading", () => {
    expect(
      stageNumbers("Stage 4 is described below.\n## Stage 4 — Messaging")
    ).toEqual([4]);
  });

  it("finds nothing in a document with no stages", () => {
    expect(stageNumbers("# User guide\n\n## What PRSync does")).toEqual([]);
  });
});

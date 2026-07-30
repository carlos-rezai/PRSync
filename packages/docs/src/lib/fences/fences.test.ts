import { describe, it, expect } from "vitest";
import { outsideFences } from "./fences";

describe("outsideFences", () => {
  it("flags every line of an unfenced document as outside", () => {
    expect(outsideFences(["# Heading", "", "Prose."])).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("counts a fence line as inside, not outside", () => {
    // The rule that looks arbitrary and is the whole point: a fence is
    // never content, so neither delimiter is a line any reader should
    // consider. Flagging the opening fence as outside would be harmless;
    // flagging the CLOSING one as outside is what would let a `#` on it
    // through.
    expect(outsideFences(["```", "code", "```"])).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("does not read a shell comment inside a fence as a heading line", () => {
    // `docs/deployment.md` carries exactly this shape, which is why every
    // reader in this workspace consults this function first.
    const lines = [
      "## Packaging and publishing the extension",
      "",
      "```bash",
      "# 1. Build the panel",
      "npm run build",
      "```",
      "",
      "## Deploying the bot",
    ];

    const outside = outsideFences(lines);
    const headings = lines.filter(
      (line, i) => outside[i] && line.startsWith("#")
    );

    expect(headings).toEqual([
      "## Packaging and publishing the extension",
      "## Deploying the bot",
    ]);
  });

  it("reopens after a fence closes", () => {
    expect(
      outsideFences(["a", "```", "in", "```", "b", "```", "in", "```", "c"])
    ).toEqual([true, false, false, false, true, false, false, false, true]);
  });

  it("treats an indented fence as a fence", () => {
    // Fences inside a list item are indented, and `docs/deployment.md`
    // writes several that way.
    expect(outsideFences(["  ```", "  code", "  ```", "after"])).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("leaves an unclosed fence open to the end of the document", () => {
    // The safe direction to be wrong in: an unclosed fence hides the rest
    // of the document from every reader, rather than inventing headings
    // and links out of code.
    expect(outsideFences(["a", "```", "code", "more code"])).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

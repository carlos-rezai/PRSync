import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { repoAt } from "./repoAt";

// `repoAt` is the one implementation of `Repo` that touches a disk, and the
// two behaviours worth pinning are both about answering `""` rather than
// throwing. Every check downstream reads first and asks questions after, so
// a `read` that threw on a directory would turn "this link points at a
// folder" — which is legal — into a crash inside a link resolver.

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

describe("repoAt", () => {
  it("reads a file's text", () => {
    // The floor: the two cases below are both "no text", and they prove
    // nothing unless reading something real works.
    expect(repoAt(repoRoot).read("packages/docs/package.json")).toContain(
      "@prsync/docs"
    );
  });

  it("yields no text for a directory, which still exists", () => {
    // The README links `docs/handoff/adaptive-cards` as a folder.
    // Existence is the whole question for an unanchored destination, and a
    // directory answers it — so `exists` says yes and `read` says nothing.
    const repo = repoAt(repoRoot);

    expect(repo.exists("docs")).toBe(true);
    expect(repo.read("docs")).toBe("");
  });

  it("yields no text for a path that is not there", () => {
    const repo = repoAt(repoRoot);

    expect(repo.exists("docs/no-such-document.md")).toBe(false);
    expect(repo.read("docs/no-such-document.md")).toBe("");
  });
});

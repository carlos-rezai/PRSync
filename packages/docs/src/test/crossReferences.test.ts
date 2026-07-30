import { describe, it, expect } from "vitest";
import { unresolvedLinks, type UnresolvedLink } from "../checks";
import { repoAt } from "../repo";
import { nothingExists } from "./fixtures/fakes";
import { CROSS_REFERENCED, repoRoot } from "./documents";

// The documents cross-reference each other instead of repeating each
// other, which is the whole point of how they were split — and a reader
// clicks between them. Not duplicating is paid for in links, and a link
// that resolves to nothing is a worse answer than the duplication it
// replaced.
//
// Nothing about a broken `#anchor` looks broken in the source: it renders
// as a link and lands the reader at the top of the page instead of at the
// paragraph they were sent to.
//
// The assertion is STRONG. It is a mechanical fact about the filesystem
// and about the headings the target documents actually carry: move a
// document, rename a heading, or delete a section, and every link into it
// goes red by name and line.
//
// What it does NOT claim is that a resolving link points somewhere USEFUL.
// A link to the wrong real heading passes, and only a human read catches
// that.

/** Unresolved links as one line each, so a failure reads like a linter. */
function report(hits: readonly UnresolvedLink[]): string[] {
  return hits.map(
    ({ document, line, target, reason }) =>
      `${document}:${line} ${target} — ${reason}`
  );
}

describe("the documents' cross-references", () => {
  it("resolves every relative link and anchor", () => {
    // This is what makes cross-referencing cheaper than duplicating: the
    // README routes three readers, the setup guide sends every value and
    // every failure to `docs/deployment.md`, and the user guide ends at
    // `docs/ubiquitous-language.md`. None of that is safe unless the
    // clicks land.
    const hits = unresolvedLinks({
      documents: CROSS_REFERENCED,
      repo: repoAt(repoRoot),
    });

    expect(
      report(hits),
      `these links resolve to nothing:\n  ${report(hits).join("\n  ")}`
    ).toEqual([]);
  });

  it("finds a link in every document it is pointed at", () => {
    // A floor. `toEqual([])` is exactly what an extractor that finds no
    // links at all produces, and these documents carry dozens of
    // cross-references between them. Pointed at their real text with a
    // repo where nothing exists, every one of them must report.
    //
    // It also pins which side of the port each path goes through: the
    // documents in the set are READ, never existence-checked — the caller
    // pins those paths, and a missing one is `readDocument`'s failure to
    // report, not a link to nowhere.
    const documents = report(
      unresolvedLinks({
        documents: CROSS_REFERENCED,
        repo: nothingExists(repoAt(repoRoot)),
      })
    ).map((line) => line.split(":")[0]);

    expect(
      new Set(documents),
      "a document contributed no unresolvable link even though nothing exists, so its links are not being read"
    ).toEqual(new Set(CROSS_REFERENCED));
  });
});

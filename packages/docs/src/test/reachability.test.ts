import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { unreachable } from "../checks";
import { repoAt } from "../repo";
import { at, README, repoRoot } from "./documents";

// Can a reader get here from the front door?
//
// The link check proves every link that exists points somewhere real. It
// says nothing about a document nobody links to — and an orphan is the
// worse failure, because a broken link is visible to whoever clicks it
// while an orphan is visible to no one. It goes stale unread, and the
// first person to find it finds a document that contradicts the ones in
// use.
//
// The document set is DISCOVERED from the filesystem rather than listed,
// so a document added to `docs/` next month is guarded the day it lands.
// That is the whole value: a listed set would need someone to remember to
// add the file, which is the same person who would have remembered to
// link it.
//
// Deliberate exceptions are named by PATH with a reason, never filtered
// by pattern. A pattern quietly grows to cover the next orphan too.

const DOCS = resolve(repoRoot, "docs");

/** Every markdown document under `docs/`, repo-relative, forward-slashed. */
function everyDocument(): string[] {
  const found: string[] = [];

  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(resolve(directory, entry.name), `${path}/`);
      } else if (entry.name.endsWith(".md")) {
        found.push(path);
      }
    }
  };

  walk(DOCS, "docs/");
  return found.sort();
}

/**
 * Documents that are deliberately not reachable from `README.md`.
 *
 * Empty today, and it should stay that way. It exists so that the first
 * genuine exception is written down with its reason rather than being
 * fixed by loosening the check.
 */
const ALLOWED_ORPHANS: readonly string[] = [];

describe("every document under docs/", () => {
  it("is reachable from the README by following links", () => {
    const documents = everyDocument();

    // A floor: an empty set makes the assertion below vacuous, and the
    // walker returning nothing is exactly what a bad `docs` path produces.
    expect(
      documents.length,
      "found no documents under docs/, so reachability proves nothing"
    ).toBeGreaterThan(0);

    const orphans = unreachable({
      from: README,
      documents,
      repo: repoAt(repoRoot),
    }).filter((path) => !ALLOWED_ORPHANS.includes(path));

    expect(
      orphans,
      `no chain of links from README.md reaches these documents, so a reader has no way to find them:\n  ${orphans.join("\n  ")}`
    ).toEqual([]);
  });

  it("is discovered rather than listed, so a new document is guarded on arrival", () => {
    // The property the check depends on. A hardcoded set would need
    // someone to remember to add the file — the same person who would
    // have remembered to link it, which is the failure being guarded.
    const documents = everyDocument();

    expect(documents).toContain("docs/user-guide.md");
    expect(documents).toContain("docs/design-logs/04-user-docs.md");
    expect(documents.every((path) => path.startsWith("docs/"))).toBe(true);
    expect(documents.every((path) => !path.includes("\\"))).toBe(true);
  });

  it("names any exception by path, with a reason", () => {
    // Not a formality. The available fix for a reported orphan is to link
    // it or to write down why it is not linked, and a pattern-shaped
    // exception quietly grows to cover the next one too.
    for (const path of ALLOWED_ORPHANS) {
      expect(
        everyDocument(),
        `${path} is exempted but does not exist`
      ).toContain(path);
    }
  });
});

// A guard on the guard: `at` and the README path are used by every spec
// here, and a mistyped front door would make the walk start nowhere and
// report every document as an orphan.
describe("the front door", () => {
  it("is a document that exists and carries links", () => {
    expect(repoAt(repoRoot).read(README).length).toBeGreaterThan(0);
    expect(at(README).endsWith("README.md")).toBe(true);
  });
});

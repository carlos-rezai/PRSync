// The markdown reads the documentation tests share.
//
// Two tests in this package assert the agreement between a document and
// the source it makes claims about: `deploymentDocs.test.ts` (every
// setting the code reads is documented, under the package that reads it)
// and `userDocs.test.ts` (the guides and the ubiquitous language do not
// drift). Both need the same three things — open a document and fail
// loudly if it is missing, isolate one section of it, and recognise a
// PRSync setting token — and the first of them had all three private.
//
// It lives here rather than in either test for the same reason
// `sourceFiles.ts` does: it is a cross-layer test helper, which is
// exactly what `src/test/fixtures/` holds, and the same reason `fakes.ts`
// and `fixtures.ts` sit outside the layer conventions.

import { existsSync, readFileSync } from "node:fs";
import { expect } from "vitest";

/**
 * The shapes every PRSync deployment setting takes. Names are discovered
 * from source rather than listed anywhere on purpose: a hardcoded list is
 * one more thing to forget to update, and would make a test pass by
 * agreeing with itself.
 *
 * Note the `g` flag: use this with `String.prototype.match`, which resets
 * `lastIndex` for you. `.test()` and `.exec()` on a shared global regex
 * resume from wherever the previous caller left off, and two test files
 * now consume this one.
 */
export const SETTING_PATTERN =
  /\b(?:MICROSOFT_APP_[A-Z0-9_]+|AZURE_[A-Z0-9_]*CONNECTION_STRING|PRSYNC_[A-Z0-9_]+|VITE_[A-Z0-9_]+)\b/g;

/**
 * A document's full text, failing under its own name if it is absent. The
 * label is what a reader sees when it is missing, so it is the repo-root
 * path rather than the resolved absolute one.
 */
export function readDoc(path: string, label: string): string {
  expect(existsSync(path), `${label} is missing`).toBe(true);
  return readFileSync(path, "utf8");
}

/**
 * The body of a section, up to the next same-or-higher heading.
 *
 * Fenced blocks are skipped when looking for that boundary: the
 * Environment Variables section is one long fence whose `# packages/api`
 * comments are shell, not markdown, and reading them as headings ends the
 * section before a single setting is seen.
 */
export function section(markdown: string, heading: RegExp): string | undefined {
  const lines = markdown.split("\n");

  const outsideFence: boolean[] = [];
  let fenced = false;
  for (const line of lines) {
    const isFence = /^\s*```/.test(line);
    outsideFence.push(!fenced && !isFence);
    if (isFence) fenced = !fenced;
  }

  const start = lines.findIndex(
    (line, i) => outsideFence[i] && heading.test(line)
  );
  if (start === -1) return undefined;

  const depth = ((lines[start] ?? "").match(/^#+/) ?? ["##"])[0].length;
  const end = lines.findIndex(
    (line, i) =>
      i > start &&
      outsideFence[i] &&
      /^#+\s/.test(line) &&
      (line.match(/^#+/) as RegExpMatchArray)[0].length <= depth
  );

  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

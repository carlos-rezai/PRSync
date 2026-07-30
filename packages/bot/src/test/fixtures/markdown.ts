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
//
// The link resolver at the bottom joins them for the same reason: the four
// user-facing documents cross-reference each other instead of repeating
// each other, and a link that resolves to nothing is a worse answer than
// the duplication it replaced.

import { existsSync, readFileSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
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
 * Which of `lines` are outside a fenced code block, one flag per line. A
 * fence line itself counts as inside it: a fence is never content.
 *
 * Every reader below needs this, and for the same reason — a `#` inside a
 * fence is a shell comment, not a heading, and `docs/deployment.md`
 * carries exactly that shape.
 */
function outsideFences(lines: readonly string[]): boolean[] {
  const outside: boolean[] = [];
  let fenced = false;

  for (const line of lines) {
    const isFence = /^\s*```/.test(line);
    outside.push(!fenced && !isFence);
    if (isFence) fenced = !fenced;
  }

  return outside;
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
  const outsideFence = outsideFences(lines);

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

/**
 * The anchor GitHub generates for a heading, which is what an `#anchor`
 * link has to match.
 *
 * The rules, and the reason a naive lowercase-and-hyphen pass is not good
 * enough: GitHub lowercases, DELETES everything that is not a letter, a
 * digit, a space, an underscore or a hyphen, and only then turns spaces
 * into hyphens. Deleting rather than hyphenating is what makes
 * ``## Why `/api/messages` is anonymous`` slug as `why-apimessages-is-…`,
 * and a link written against the hyphenated guess resolves against
 * nothing while looking correct.
 *
 * The consequence that looks like a bug and is not: an em-dash is deleted
 * and the two spaces around it survive, so every heading in this repo's
 * house style slugs with a DOUBLE hyphen. Tidying runs of hyphens away is
 * wrong for every stage heading in `docs/setup-guide.md` at once.
 */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * The filesystem the link resolver reads, keyed by repo-relative path.
 *
 * It is a port rather than `node:fs` because the two failures the
 * cross-reference assertion exists to catch — a link to a missing file and
 * an anchor matching no heading — are the two things the real repo, being
 * correct, cannot demonstrate. Same trick `QueueProducer` and
 * `TeamsSender` play on their vendor clients.
 */
export interface Repo {
  /** Whether anything at all — file or directory — is at `path`. */
  exists(path: string): boolean;
  /** The text at `path`; `""` where there is no text to read. */
  read(path: string): string;
}

/** Why a link resolves to nothing. */
export type UnresolvedReason = "no such file" | "no such heading";

/** One link that goes nowhere, named the way a linter would name it. */
export interface UnresolvedLink {
  /** The document it is written in, repo-relative. */
  document: string;
  /** The 1-based line it is written on. */
  line: number;
  /** The destination exactly as written, so the failure is greppable. */
  target: string;
  reason: UnresolvedReason;
}

/** What to check: the documents, and the filesystem to resolve against. */
export interface LinkCheck {
  /**
   * The documents to read, repo-relative. Data rather than parameters, so
   * adding a fourth document changes no signature anywhere.
   */
  documents: readonly string[];
  repo: Repo;
}

/** A real repository rooted at `root`, for the assertion about this one. */
export function repoAt(root: string): Repo {
  const at = (path: string) => resolve(root, path);

  return {
    exists: (path) => existsSync(at(path)),
    read: (path) => {
      const full = at(path);
      // A directory is a legitimate destination and has no text: existence
      // is the whole question for an unanchored link.
      return existsSync(full) && statSync(full).isFile()
        ? readFileSync(full, "utf8")
        : "";
    },
  };
}

/** `[text](destination)`, capturing the destination and dropping a title. */
const MARKDOWN_LINK = /\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g;

/**
 * A destination that is not a path inside this repository: an absolute
 * URL, a `mailto:`, a protocol-relative host, or a site-root path. The
 * resolver takes no position on the web, and no document in this repo
 * writes a leading slash.
 */
function isOutsideRepo(destination: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(destination);
}

/** Every heading anchor `markdown` actually offers. */
function headingSlugs(markdown: string): Set<string> {
  const lines = markdown.split("\n");
  const outside = outsideFences(lines);
  const slugs = new Set<string>();

  lines.forEach((line, index) => {
    if (!outside[index]) return;
    // Deliberately unanchored at the end: these documents are CRLF, and a
    // `$` after `(.*)` matches nothing on a line ending in `\r`. What the
    // capture picks up instead is trimmed by `githubSlug`.
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) slugs.add(githubSlug(heading[1] ?? ""));
  });

  return slugs;
}

/**
 * Every relative link and `#anchor` in `documents` that resolves to
 * nothing — a missing file, or an anchor matching no heading in the
 * document it points at.
 *
 * Each destination is resolved relative to the document it is written in,
 * because `README.md` and `docs/setup-guide.md` must spell the same target
 * differently. Resolving everything from the repo root instead passes both
 * spellings, which is the bug that makes a link checker worthless.
 */
export function unresolvedLinks({
  documents,
  repo,
}: LinkCheck): UnresolvedLink[] {
  const hits: UnresolvedLink[] = [];
  const anchors = new Map<string, Set<string>>();

  /** `path`'s anchors, read once however many links point at it. */
  const anchorsOf = (path: string, known?: string): Set<string> => {
    const cached = anchors.get(path);
    if (cached) return cached;

    const found = headingSlugs(known ?? repo.read(path));
    anchors.set(path, found);
    return found;
  };

  for (const document of documents) {
    // The documents in the set are READ, never existence-checked: the
    // caller pins those paths, and a missing one is `readDoc`'s failure to
    // report rather than a link to nowhere.
    const text = repo.read(document);
    const lines = text.split("\n");
    const outside = outsideFences(lines);
    const directory = posix.dirname(document);

    lines.forEach((line, index) => {
      if (!outside[index]) return;

      for (const match of line.matchAll(MARKDOWN_LINK)) {
        const target = match[1] ?? "";
        if (isOutsideRepo(target)) continue;

        const [file, anchor] = splitAnchor(target);
        const path = file === "" ? document : posix.join(directory, file);

        if (file !== "" && !repo.exists(path)) {
          hits.push({
            document,
            line: index + 1,
            target,
            reason: "no such file",
          });
          continue;
        }

        if (anchor === undefined) continue;

        const own = path === document ? text : undefined;
        if (!anchorsOf(path, own).has(anchor)) {
          hits.push({
            document,
            line: index + 1,
            target,
            reason: "no such heading",
          });
        }
      }
    });
  }

  return hits;
}

/**
 * A destination split into its file part and its anchor. An empty file
 * part is a bare `#anchor`, which resolves against the linking document's
 * own headings.
 */
function splitAnchor(destination: string): [string, string | undefined] {
  const hash = destination.indexOf("#");
  if (hash === -1) return [destination, undefined];

  return [
    destination.slice(0, hash),
    destination.slice(hash + 1).toLowerCase(),
  ];
}

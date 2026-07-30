import { posix } from "node:path";
import { githubSlug, outsideFences } from "../../lib";
import type { Repo } from "../../repo";

// The check that makes cross-referencing cheaper than duplicating. The
// five user-facing documents point at each other instead of repeating each
// other, which is the whole point — and a link that resolves to nothing is
// a worse answer than the duplication it replaced. Nothing about a broken
// `#anchor` looks broken in the source: it renders as a link and lands the
// reader at the top of a 600-line reference.

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
   * adding a sixth document changes no signature anywhere.
   */
  documents: readonly string[];
  repo: Repo;
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
    // caller pins those paths, and a missing one is `readDocument`'s
    // failure to report rather than a link to nowhere.
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

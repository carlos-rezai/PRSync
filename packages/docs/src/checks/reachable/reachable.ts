import { posix } from "node:path";
import { outsideFences } from "../../lib";
import type { Repo } from "../../repo";

// The one question the link resolver cannot answer.
//
// `unresolvedLinks` proves every link that EXISTS points somewhere real.
// It says nothing whatsoever about a document nobody links to — and an
// unreachable document is worse than a broken link, because a broken link
// is visible to whoever clicks it while an orphan is visible to no one.
// It goes stale unread, and the first person to find it finds a document
// that contradicts the ones in use.
//
// So this walks the other way: start at the front door and see what a
// reader can actually get to.

/** `[text](destination)`, capturing the destination and dropping a title. */
const MARKDOWN_LINK = /\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g;

/** What to walk: where a reader starts, and what they ought to reach. */
export interface ReachCheck {
  /** The document a reader starts at, repo-relative — the front door. */
  from: string;
  /**
   * Every document that ought to be reachable, repo-relative. Data rather
   * than a glob, because the caller is the only thing that knows which
   * paths are documents and which are deliberate exceptions.
   */
  documents: readonly string[];
  repo: Repo;
}

/**
 * A destination that is not a path inside this repository: an absolute
 * URL, a `mailto:`, a protocol-relative host, or a site-root path.
 */
function isOutsideRepo(destination: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(destination);
}

/**
 * Every path `document` links to, resolved relative to it and stripped of
 * anchors. Fenced blocks are skipped, so a link written inside a shell
 * example is not a route a reader can take.
 */
function linksFrom(document: string, repo: Repo): string[] {
  const lines = repo.read(document).split("\n");
  const outside = outsideFences(lines);
  const directory = posix.dirname(document);
  const found: string[] = [];

  lines.forEach((line, index) => {
    if (!outside[index]) return;

    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const target = match[1] ?? "";
      if (isOutsideRepo(target)) continue;

      const file = target.split("#")[0] ?? "";
      // A bare `#anchor` is a jump within the same document, not a route
      // to another one.
      if (file === "") continue;

      found.push(posix.join(directory, file));
    }
  });

  return found;
}

/**
 * Every document in `documents` that no chain of links from `from`
 * reaches.
 *
 * Reachability is TRANSITIVE, which is the whole point: the README is not
 * required to link everything itself, only to be the root of a tree that
 * covers everything. A document linked solely from the user guide is
 * reachable, because a reader routed to the user guide can get there.
 */
export function unreachable({ from, documents, repo }: ReachCheck): string[] {
  const seen = new Set<string>([from]);
  const queue = [from];

  while (queue.length > 0) {
    // Non-null: the loop condition is the length check.
    const current = queue.shift() as string;

    for (const target of linksFrom(current, repo)) {
      if (seen.has(target)) continue;
      seen.add(target);
      // Only markdown is walked THROUGH. A directory or an image can be
      // reached, but it carries no links onward.
      if (target.endsWith(".md")) queue.push(target);
    }
  }

  return documents.filter((document) => !seen.has(document));
}

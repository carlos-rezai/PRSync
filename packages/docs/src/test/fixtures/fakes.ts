// One complete typed fake per port. This workspace has exactly one port,
// so this file has exactly one fake — the same shape
// `packages/bot/src/test/fixtures/fakes.ts` and
// `packages/extension/src/test/fixtures/` take.
//
// It lives outside the layer conventions for the reason every fixtures
// directory in this repo does: every layer's tests consume it, so putting
// it inside any one module would force imports upward and across layers.

import type { Repo } from "../../repo";

/**
 * A repository that exists for the length of one assertion: a map from
 * repo-relative path to text.
 *
 * Every check takes its filesystem as a `Repo` for the same reason —
 * "reports a link to a missing file", "reports an anchor matching no
 * heading", "reports a document nothing links to" and "reports a sentence
 * that describes the wrong close rule" are what the checks must be able to
 * do, and are exactly what the real repository, being correct, cannot
 * demonstrate. A fake is the only place they are provable.
 *
 * A key with empty text is a directory: nothing unanchored is ever read,
 * so a directory needs no content to exist.
 */
export function fakeRepo(files: Record<string, string>): Repo {
  return {
    exists: (path) => path in files,
    read: (path) => files[path] ?? "",
  };
}

/**
 * A `Repo` that reads real text but claims nothing exists.
 *
 * The shape every "did this check actually read anything?" floor needs:
 * `toEqual([])` is also what an extractor that finds no links at all
 * produces, so each repo-level assertion is paired with a run against this,
 * where every link in every document must report.
 */
export function nothingExists(real: Repo): Repo {
  return { exists: () => false, read: (path) => real.read(path) };
}

/**
 * A `Repo` that records every path asked of it, so "never reads the paper
 * trail" is a fact rather than an arrangement that happens to hold today.
 */
export function recordingRepo(real: Repo): { repo: Repo; touched: string[] } {
  const touched: string[] = [];

  return {
    touched,
    repo: {
      exists: (path) => {
        touched.push(path);
        return real.exists(path);
      },
      read: (path) => {
        touched.push(path);
        return real.read(path);
      },
    },
  };
}

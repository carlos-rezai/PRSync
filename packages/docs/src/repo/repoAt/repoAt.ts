import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The filesystem a check reads, keyed by repo-relative path.
 *
 * It is a port rather than `node:fs` because the failures these checks
 * exist to catch — a link to a missing file, an anchor matching no
 * heading, a document nothing links to — are the things the real
 * repository, being correct, cannot demonstrate. A fake is the only place
 * they are provable. Same trick `QueueProducer` and `TeamsSender` play on
 * their vendor clients.
 *
 * It is declared here, beside its one real implementation, rather than in
 * a `types.ts` of its own — the same call `packages/bot` made for the
 * queue envelope in `QueueNotificationPort`.
 */
export interface Repo {
  /** Whether anything at all — file or directory — is at `path`. */
  exists(path: string): boolean;
  /** The text at `path`; `""` where there is no text to read. */
  read(path: string): string;
}

/** A real repository rooted at `root`, for the assertions about this one. */
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

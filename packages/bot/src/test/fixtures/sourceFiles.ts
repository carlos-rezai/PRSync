// The source walk the policy tests share.
//
// Two tests in this package assert properties of the SOURCE rather than of
// any behaviour: `layerPolicy.test.ts` (the vendor SDK stays in `teams/`,
// table access stays a point read) and `deploymentDocs.test.ts` (every
// setting the code reads is documented). Both need the same thing — every
// TypeScript file under a root, as text, with its path — and each
// hand-rolled its own directory walk to get it.
//
// It lives here rather than in either test because it is a cross-layer
// test helper, which is exactly what `src/test/fixtures/` holds; the same
// reason `fakes.ts` and `fixtures.ts` sit outside the layer conventions.

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export interface SourceFile {
  /**
   * Path relative to the walked root, forward-slashed regardless of
   * platform, e.g. `teams/BotAdapter/BotAdapter.ts`. Forward-slashed so
   * that a rule written as `path.startsWith("teams/")` means the same
   * thing on Windows as in CI.
   */
  path: string;
  text: string;
}

export interface SourceWalkOptions {
  /** Absolute path of the directory to walk. */
  root: string;
  /**
   * Whether co-located tests are included. Rules about what SHIPS read
   * production files only; rules about how storage is addressed read
   * everything, because a test that scanned a table would be asserting
   * against a repository the product forbids.
   */
  includeTests?: boolean;
  /**
   * Files to leave out, by their root-relative path. Called for every file
   * that would otherwise be returned — a test uses it to skip itself when
   * it names the very tokens it forbids.
   */
  exclude?: (path: string) => boolean;
}

/**
 * Every `.ts`/`.tsx` file under `root`, with its text. `node_modules` is
 * never walked: it is never source, and walking it turns a millisecond
 * into a minute.
 */
export function readSourceFiles({
  root,
  includeTests = false,
  exclude = () => false,
}: SourceWalkOptions): SourceFile[] {
  const files: SourceFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (!includeTests && /\.test\.tsx?$/.test(entry.name)) continue;

      const path = relative(root, full).split(sep).join("/");
      if (exclude(path)) continue;

      files.push({ path, text: readFileSync(full, "utf8") });
    }
  };

  walk(root);
  return files;
}

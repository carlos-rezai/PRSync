import { existsSync, readFileSync } from "node:fs";

/**
 * A document's full text, failing under its own name if it is absent.
 *
 * The label is the whole feature. Every caller reads by absolute path, so
 * an unlabelled failure names a path with the author's home directory in
 * it; the label is the repo-root path, which is what a reader's editor and
 * every other failure message in this workspace call the same file.
 *
 * It THROWS rather than asserting. This was `readDoc`, and it called
 * `expect` from vitest — legitimate while it lived in `src/test/fixtures/`,
 * where a fixture may, and not legitimate in a layer, where a module may
 * not. The message a reader sees is unchanged.
 */
export function readDocument(path: string, label: string): string {
  if (!existsSync(path)) throw new Error(`${label} is missing`);
  return readFileSync(path, "utf8");
}

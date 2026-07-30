import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readSourceFiles } from "./sourceFiles";

// The walker's first co-located test in either workspace. It has been
// copied once and consumed by three tests without one, which is the
// argument for writing it now rather than the argument against.
//
// It is driven against this workspace's own `src/`, which is small, has a
// known shape, and — unlike a temporary directory — makes every
// expectation below readable as a fact about the repo.

const docsSrc = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = resolve(docsSrc, "../../..");

describe("readSourceFiles", () => {
  it("returns every source file under the root, with its text", () => {
    const files = readSourceFiles({ root: docsSrc });
    const paths = files.map(({ path }) => path);

    expect(paths).toContain("repo/sourceFiles/sourceFiles.ts");
    expect(files.find(({ path }) => path === "repo/index.ts")?.text).toContain(
      "Barrel for the repo layer"
    );
  });

  it("forward-slashes its paths on any platform", () => {
    // A rule written as `path.startsWith("teams/")` has to mean the same
    // thing on Windows as in CI, and `node:path` would hand back
    // backslashes here.
    const paths = readSourceFiles({ root: docsSrc }).map(({ path }) => path);

    expect(paths.every((path) => !path.includes("\\"))).toBe(true);
    expect(paths.some((path) => path.includes("/"))).toBe(true);
  });

  it("excludes co-located tests unless asked for them", () => {
    // Rules about what SHIPS read production files only; rules about how
    // storage is addressed read everything, because a test that scanned a
    // table would be asserting against a repository the product forbids.
    const withoutTests = readSourceFiles({ root: docsSrc }).map(
      ({ path }) => path
    );
    const withTests = readSourceFiles({
      root: docsSrc,
      includeTests: true,
    }).map(({ path }) => path);

    expect(withoutTests).not.toContain("repo/sourceFiles/sourceFiles.test.ts");
    expect(withTests).toContain("repo/sourceFiles/sourceFiles.test.ts");
  });

  it("honours exclude, by root-relative path", () => {
    // What `deploymentDocs.test.ts` uses to skip `src/test/`, whose
    // fixtures name settings that are not deployment requirements.
    const paths = readSourceFiles({
      root: docsSrc,
      exclude: (path) => path.startsWith("repo/"),
    }).map(({ path }) => path);

    expect(paths.some((path) => path.startsWith("repo/"))).toBe(false);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("never walks node_modules", () => {
    // Not tidiness: `node_modules` is never source, and walking it turns a
    // millisecond into a minute. Driven from the repo root, which is the
    // one place in this repo where the directory is unavoidable.
    const paths = readSourceFiles({ root: repoRoot }).map(({ path }) => path);

    expect(paths.some((path) => path.includes("node_modules"))).toBe(false);
    expect(paths).toContain("packages/docs/src/repo/index.ts");
  });
});

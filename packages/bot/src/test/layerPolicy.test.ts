import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Two of this slice's acceptance criteria are properties of the SOURCE,
// not of any behaviour a test can drive:
//
//   1. `botbuilder` is confined to `teams/`. It is the vendor seam, the
//      exact analogue of the extension's `sdk/` layer, and the reason
//      every other layer is testable without Bot Framework in the test at
//      all. An import that leaks into `services/` still works, still
//      passes every behaviour test, and quietly removes that property.
//
//   2. Table access is a point read by exact partition + row key, from
//      `storage/` and nowhere else. That is what makes injection
//      impossible by construction rather than by escaping. A
//      `listEntities` added later to "just check whether the row is
//      there" reintroduces the whole class of problem, and no behavioural
//      test would notice.
//
// Both are asserted by reading the source, in the spirit of
// `packages/api/src/test/lintPolicy.test.ts` and the extension's
// `packaging.test.ts`: contracts caught in the suite rather than in
// review, or not at all.
//
// Each is one test rather than two, deliberately. "Nothing has escaped
// the seam" passes just as happily when the seam does not exist yet, so
// it is asserted together with "the seam is there" — otherwise the day
// the layer is deleted is the day this file goes quiet.

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/** This file names the very tokens it forbids, so it cannot judge itself. */
const SELF = "test/layerPolicy.test.ts";

/**
 * `src/test/` is fixtures and policy — it stands outside the layer
 * conventions on purpose, because every layer's tests consume it.
 */
const EXCLUDED_PREFIXES = ["test/"];

interface SourceFile {
  /** Path relative to `src/`, forward-slashed, e.g. `teams/BotHost/BotHost.ts`. */
  path: string;
  text: string;
}

/**
 * @param includeTests Co-located tests reach for things their subject may
 * not — `BotHost.activities.test.ts` drives Bot Framework's own
 * `TestAdapter`, which is the correct place for it. Rules about what
 * ships read production files only; rules about how storage is addressed
 * read everything, because a test that scanned a table would be asserting
 * against a repository the product forbids.
 */
function readSources(includeTests: boolean): SourceFile[] {
  const files: SourceFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (!includeTests && /\.test\.tsx?$/.test(entry.name)) continue;

      const path = relative(srcRoot, full).split(sep).join("/");
      if (path === SELF) continue;
      if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;

      files.push({ path, text: readFileSync(full, "utf8") });
    }
  };

  walk(srcRoot);
  return files;
}

/** Files whose import statements name `specifier` or a subpath of it. */
function importersOf(specifier: string, includeTests = false): string[] {
  const pattern = new RegExp(
    `from\\s+["']${specifier.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}(/[^"']*)?["']`
  );
  return readSources(includeTests)
    .filter((file) => pattern.test(file.text))
    .map((file) => file.path)
    .sort();
}

describe("the botbuilder seam", () => {
  it("owns the vendor SDK from teams/, and from nowhere else", () => {
    const importers = [
      ...importersOf("botbuilder"),
      ...importersOf("botbuilder-core"),
      ...importersOf("botframework-connector"),
      ...importersOf("botframework-schema"),
    ];

    expect(
      importers.length,
      "no module imports botbuilder — teams/ is meant to own the adapter outright"
    ).toBeGreaterThan(0);

    for (const path of importers) {
      expect(
        path.startsWith("teams/"),
        `${path} imports botbuilder outside teams/, so the layer below it can ` +
          "no longer be tested without Bot Framework"
      ).toBe(true);
    }
  });
});

describe("table access", () => {
  it("reaches @azure/data-tables only from storage/, and only by point read", () => {
    const importers = importersOf("@azure/data-tables");

    expect(
      importers.length,
      "nothing imports @azure/data-tables — storage/ is meant to be the one layer that does"
    ).toBeGreaterThan(0);

    for (const path of importers) {
      expect(
        path.startsWith("storage/"),
        `${path} touches @azure/data-tables outside storage/`
      ).toBe(true);
    }

    // Every read is a point read by exact partition + row key. These are
    // the SDK's ways of asking for a *set* of rows, and none can be used
    // without building a filter over a value that arrived from Teams.
    for (const token of ["listEntities", "queryOptions", "odata`"]) {
      const offenders = readSources(true)
        .filter((file) => file.text.includes(token))
        .map((file) => file.path);

      expect(
        offenders,
        `${token} builds a query where the design calls for a point read`
      ).toEqual([]);
    }
  });
});

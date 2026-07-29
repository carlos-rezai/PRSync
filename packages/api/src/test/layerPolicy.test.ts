import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Two properties of the SOURCE that no behavioural test can reach, both
// of which this slice is the first to put at risk — because it adds the
// one module that assembles every other one.
//
//   1. `@azure/data-tables` stays inside `storage/`. Wiring a repository
//      from the composition root is the obvious moment to import
//      `TableClient` in `src/index.ts` "just to construct one", and the
//      layer rule would then hold for every layer except the one that
//      builds them all. It still works, every test still passes, and the
//      property is quietly gone.
//
//   2. A `NotificationPort` implementation is named in exactly one place.
//      The next slice swaps `NoopNotificationPort` for the real queue
//      producer, and "swapping it is a one-line change" is only true
//      while no other module has reached for a concrete implementation
//      instead of the interface.
//
// Both are asserted by reading the source, in the spirit of
// `packages/bot/src/test/layerPolicy.test.ts` and this package's
// `lintPolicy.test.ts`.
//
// Each is one test rather than two: "nothing has escaped the seam" passes
// just as happily when the seam does not exist at all, so it is asserted
// together with "the seam is there".

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/** This file names the very tokens it constrains, so it cannot judge itself. */
const SELF = "test/layerPolicy.test.ts";

/**
 * `src/test/` is fixtures and policy — it stands outside the layer
 * conventions on purpose, because every layer's tests consume it.
 */
const EXCLUDED_PREFIXES = ["test/"];

interface SourceFile {
  /** Path relative to `src/`, forward-slashed, e.g. `storage/index.ts`. */
  path: string;
  text: string;
}

/**
 * @param includeTests Co-located tests reach for things their subject may
 * not — `RoundRepository.test.ts` drives a real `TableClient` against the
 * emulator, which is the correct place for it. Rules about what ships
 * read production files only.
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
      if (!entry.name.endsWith(".ts")) continue;
      if (!includeTests && /\.test\.ts$/.test(entry.name)) continue;

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
function importersOf(specifier: string): string[] {
  const pattern = new RegExp(
    `from\\s+["']${specifier.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}(/[^"']*)?["']`
  );
  return readSources(false)
    .filter((file) => pattern.test(file.text))
    .map((file) => file.path)
    .sort();
}

describe("table access", () => {
  it("reaches @azure/data-tables only from storage/, which is where the composition root asks for a repository", () => {
    const importers = importersOf("@azure/data-tables");

    expect(
      importers.length,
      "nothing imports @azure/data-tables — storage/ is meant to be the one layer that does"
    ).toBeGreaterThan(0);

    for (const path of importers) {
      expect(
        path.startsWith("storage/"),
        `${path} touches @azure/data-tables outside storage/, so the layer rule now holds everywhere except where the layers are assembled`
      ).toBe(true);
    }

    // Asserted together, because "nothing outside storage/ imports the
    // SDK" is trivially true of a package that assembles nothing — which
    // is what this one was. What keeps it true once there IS a
    // composition root is that the root has a way to obtain a repository
    // without a `TableClient` of its own.
    const root = readSources(false).find((file) => file.path === "index.ts");
    expect(root, "there is no composition root").toBeDefined();
    expect(
      root?.text,
      "the composition root does not build its repository through storage/'s factory, so the only way it has one is a TableClient of its own"
    ).toContain("createRoundRepository");
  });
});

describe("the notification port", () => {
  it("has its implementation chosen in the composition root, and nowhere else", () => {
    const sources = readSources(false);

    // Every class declaring itself an implementation, found by what it
    // says it is rather than by a name this test would have to be kept in
    // step with as implementations come and go.
    const implementations = sources.flatMap((file) =>
      [
        ...file.text.matchAll(
          /class\s+(\w+)\s+implements\s+NotificationPort\b/g
        ),
      ].map((match) => ({ name: match[1] as string, definedIn: file.path }))
    );

    expect(
      implementations.map(({ name }) => name),
      "no class implements NotificationPort — there is no port to install"
    ).not.toEqual([]);

    for (const { name, definedIn } of implementations) {
      const namedBy = sources
        .filter(
          (file) =>
            file.path !== definedIn &&
            new RegExp(`\\b${name}\\b`).test(file.text)
        )
        .map((file) => file.path)
        .sort();

      // Not "at most one place" — exactly `index.ts`. A port named
      // nowhere at all is a port nothing installs, which is the state
      // this package is in before the composition root exists.
      expect(
        namedBy,
        `${name} should be named only by the composition root — swapping the live port is meant to be a one-line change in one file`
      ).toEqual(["index.ts"]);
    }
  });
});

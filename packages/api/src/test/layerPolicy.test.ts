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

/**
 * Every class declaring itself a `NotificationPort`, found by what it says
 * it is rather than by a name this test would have to be kept in step with
 * as implementations come and go.
 */
function notificationPortImplementations(): {
  name: string;
  definedIn: string;
}[] {
  return readSources(false).flatMap((file) =>
    [
      ...file.text.matchAll(/class\s+(\w+)\s+implements\s+NotificationPort\b/g),
    ].map((match) => ({ name: match[1] as string, definedIn: file.path }))
  );
}

describe("the notification port", () => {
  // Restated for the slice that installs the real producer. The property
  // this has always been protecting is "no module has reached past the
  // interface for a concrete implementation" — and the earlier wording,
  // `namedBy === ["index.ts"]` for EVERY implementation, only expressed
  // that while exactly one implementation existed. With the queue
  // producer live, `NoopNotificationPort` is named by nobody, which the
  // old assertion reads as a regression and which is in fact the point:
  // the stub stays in the codebase as the no-op/test implementation and
  // the root stops choosing it. So the rule splits in two.

  it("lets no module outside the composition root name a concrete implementation", () => {
    const sources = readSources(false);
    const implementations = notificationPortImplementations();

    expect(
      implementations.map(({ name }) => name),
      "no class implements NotificationPort — there is no port to install"
    ).not.toEqual([]);

    for (const { name, definedIn } of implementations) {
      const namedBy = sources
        .filter(
          (file) =>
            file.path !== definedIn &&
            // A layer barrel re-exports its modules BY PATH, so a folder
            // named after the class it holds puts the class name in the
            // barrel's text without anything having chosen it. Publishing
            // a module is not installing it — only `index.ts`, the one
            // file with no layer above it, does that.
            !/\/index\.ts$/.test(file.path) &&
            new RegExp(`\\b${name}\\b`).test(file.text)
        )
        .map((file) => file.path)
        .sort();

      expect(
        namedBy.filter((path) => path !== "index.ts"),
        `${name} is named by a module that is not the composition root — swapping the live port is meant to be a one-line change in one file`
      ).toEqual([]);
    }
  });

  it("has exactly one implementation installed, chosen in the composition root", () => {
    const implementations = notificationPortImplementations();
    const root = readSources(false).find((file) => file.path === "index.ts");
    expect(root, "there is no composition root").toBeDefined();

    const installed = implementations
      .filter(({ name }) => new RegExp(`\\b${name}\\b`).test(root?.text ?? ""))
      .map(({ name }) => name);

    // One, not "at least one": a root that names two has a dead branch,
    // and a root that names none installs nothing while the app starts
    // and serves happily.
    expect(
      installed,
      "the composition root names no NotificationPort implementation, so the seam is wired to nothing"
    ).toHaveLength(1);
  });

  it("keeps the no-op stub in the codebase, unwired", () => {
    // Not dead code — it is the implementation a test or a local run
    // installs when the queue is not the point. Deleting it because the
    // root stopped naming it would take the option away with it.
    const names = notificationPortImplementations().map(({ name }) => name);

    expect(names).toContain("NoopNotificationPort");
    expect(names.length, "the no-op stub is the only implementation, so nothing real is installed").toBeGreaterThan(1);
  });
});

describe("queue access", () => {
  it("reaches @azure/storage-queue only from storage/, which is where the composition root asks for a queue", () => {
    // The same rule `@azure/data-tables` lives under, for the same
    // reason. `services/` owns the fan-out RULES — who gets a message and
    // how many — and it can only be tested against a fake queue if no
    // Azure SDK is reachable from it. The producer is the obvious place
    // to construct a `QueueClient` "just to send with", and doing so
    // would leave the port untestable without a storage account.
    const importers = importersOf("@azure/storage-queue");

    expect(
      importers.length,
      "nothing imports @azure/storage-queue — storage/ is meant to be the one layer that does"
    ).toBeGreaterThan(0);

    for (const path of importers) {
      expect(
        path.startsWith("storage/"),
        `${path} touches @azure/storage-queue outside storage/, so the notification producer can no longer be driven without a real queue`
      ).toBe(true);
    }

    const root = readSources(false).find((file) => file.path === "index.ts");
    expect(root, "there is no composition root").toBeDefined();
    expect(
      root?.text,
      "the composition root does not build its queue through storage/'s factory, so the only way it has one is a QueueClient of its own"
    ).toContain("createNotificationQueue");
  });
});

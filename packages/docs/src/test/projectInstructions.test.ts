import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { section } from "../lib";
import { readDocument } from "../repo";
import { at, repoRoot } from "./documents";
import { discoverSettings } from "./settings";

// The three assertions whose subject is `.claude/CLAUDE.md` — the project
// instructions — rather than a document a user reads. They are a file of
// their own because the reason they behave unlike every other spec here
// is easier to find when it is the whole file's subject.
//
// THE SKIP RATIONALE. `.claude/CLAUDE.md` is a deliberate local override
// and is gitignored, so a fresh clone does not have it. These tests guard
// the AUTHOR's working copy against drift between the project
// instructions and the source — a real check, and the only place several
// of this repo's layer conventions are recorded, since design logs are
// immutable snapshots.
//
// They are SKIPPED rather than failed when the file is absent. Failing
// would mean a clone cannot get the suite green; deleting them gives up
// the check; making them pass everywhere means force-adding a gitignored
// file, which is the author's call and not a test's. A clone was never
// given the file to drift from, so there is nothing there to assert
// against. In every working copy that HAS it, these run and still fail on
// real drift.

const packagesDir = resolve(repoRoot, "packages");
const claudeMdPath = at(".claude/CLAUDE.md");

/**
 * A package's layers: every directory under its `src/` that has a barrel,
 * `test/` excepted.
 *
 * A barrel is the same definition every package's own import conventions
 * use — a layer is a thing with a public API — so this cannot drift from
 * what the rule means.
 */
function layersOf(pkg: string): string[] {
  const src = resolve(packagesDir, pkg, "src");

  return readdirSync(src, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== "test" &&
        existsSync(resolve(src, entry.name, "index.ts"))
    )
    .map((entry) => entry.name);
}

/** Every workspace that has layers at all, discovered rather than listed. */
function layeredPackages(): string[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(packagesDir, entry.name, "src"))
    )
    .map((entry) => entry.name)
    .filter((pkg) => layersOf(pkg).length > 0)
    .sort();
}

const projectInstructions = existsSync(claudeMdPath) ? describe : describe.skip;

projectInstructions(".claude/CLAUDE.md", () => {
  it("documents each setting under the package that reads it", () => {
    // Presence anywhere in the file is not enough. A setting listed only
    // under the package that does NOT read it tells someone configuring
    // the other Function App that they do not need it.
    const doc = readDocument(claudeMdPath, ".claude/CLAUDE.md");
    const body = section(doc, /^#+\s.*environment variables/i);
    expect(
      body,
      ".claude/CLAUDE.md has no Environment Variables section"
    ).toBeTruthy();

    // The block is grouped by `# packages/<name>` comment lines.
    const declared = new Set<string>();
    let current = "";
    for (const line of (body as string).split("\n")) {
      const header = line.match(/^#\s*packages\/(\S+)/);
      if (header) {
        current = header[1] ?? "";
        continue;
      }
      const setting = line.match(/^([A-Z][A-Z0-9_]*)=/);
      if (setting && current) {
        declared.add(`${current}:${setting[1]}`);
      }
    }

    const missing = discoverSettings()
      .filter(({ package: pkg, name }) => !declared.has(`${pkg}:${name}`))
      .map(({ package: pkg, name }) => `${name} under # packages/${pkg}`);

    expect(
      missing,
      `.claude/CLAUDE.md does not document these settings against the package that reads them:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("documents every layer every workspace actually has", () => {
    // Generalised rather than re-pinned. This read `packages/bot` by name,
    // which meant a fourth workspace's layers were guarded by nobody —
    // and `packages/docs` promptly became that workspace. Any package
    // that grows a layer is now covered by the rule that already covered
    // the other three.
    const doc = readDocument(claudeMdPath, ".claude/CLAUDE.md");

    let checked = 0;

    for (const pkg of layeredPackages()) {
      const body = section(
        doc,
        new RegExp(
          `^#+\\s+Layer Responsibilities \\(within \`packages/${pkg}/src/\`\\)`
        )
      );

      expect(
        body,
        `.claude/CLAUDE.md has no layer table for packages/${pkg}/src/, so that package's layer conventions are recorded nowhere`
      ).toBeTruthy();

      const undocumented = layersOf(pkg).filter(
        (layer) => !(body as string).includes(`${layer}/`)
      );

      expect(
        undocumented,
        `the packages/${pkg}/src/ layer table does not describe: ${undocumented.join(", ")}`
      ).toEqual([]);

      checked += 1;
    }

    // A floor: a discovery bug that found no layered package would make
    // every assertion above vacuous by never running one.
    expect(
      checked,
      "found no layered package, so the layer tables were never read"
    ).toBeGreaterThan(1);
  });

  it("no longer reports Teams Notifications as not started", () => {
    // The build-status entry is the first thing read about where the
    // project stands. A shipped feature still listed as not started is a
    // claim the repo contradicts.
    const doc = readDocument(claudeMdPath, ".claude/CLAUDE.md");
    const body = section(doc, /^#+\s+Feature 3\b/);

    expect(
      body,
      ".claude/CLAUDE.md has no Feature 3 build-status entry"
    ).toBeTruthy();

    expect(
      /^\s*- \[ \]/m.test(body as string),
      "Feature 3 is still listed as an unchecked build-status item"
    ).toBe(false);
    expect(
      /^\s*- \[x\]/m.test(body as string),
      "Feature 3 has no completed build-status item"
    ).toBe(true);
  });
});

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
const botRoot = resolve(packagesDir, "bot");
const claudeMdPath = at(".claude/CLAUDE.md");

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

  it("documents every layer packages/bot/src actually has", () => {
    // The api and extension packages each have a layer table; the bot's
    // layers were introduced by this feature and are the deviation the
    // issue asks be recorded, since design logs are immutable snapshots.
    const doc = readDocument(claudeMdPath, ".claude/CLAUDE.md");
    const body = section(
      doc,
      /^#+\s+Layer Responsibilities \(within `packages\/bot\/src\/`\)/
    );

    expect(
      body,
      ".claude/CLAUDE.md has no layer table for packages/bot/src/, so the bot's layer conventions are recorded nowhere"
    ).toBeTruthy();

    // A layer is a directory with a barrel — the same definition the
    // package's own import conventions use.
    const layers = readdirSync(resolve(botRoot, "src"), {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== "test" &&
          existsSync(resolve(botRoot, "src", entry.name, "index.ts"))
      )
      .map((entry) => entry.name);

    expect(layers.length).toBeGreaterThan(0);

    const undocumented = layers.filter(
      (layer) => !(body as string).includes(`${layer}/`)
    );

    expect(
      undocumented,
      `the packages/bot/src/ layer table does not describe: ${undocumented.join(", ")}`
    ).toEqual([]);
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

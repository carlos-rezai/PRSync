import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSourceFiles } from "./fixtures/sourceFiles";
import { SETTING_PATTERN, readDoc, section } from "./fixtures/markdown";

// This slice ships documentation, so there is no behaviour to drive. What
// there IS, and what rots silently, is the agreement between a document
// and the source it makes claims about:
//
//   1. a setting the code reads but no document names is a deploy that
//      comes up healthy and does nothing — the failure mode the whole
//      deployment doc exists to prevent;
//   2. the anonymous-endpoint rationale is a claim about a value
//      `teamsMessages.ts` owns. Change the value and the rationale
//      becomes a lie that reads as a considered decision;
//   3. a layer added to `packages/bot/src/` that `.claude/CLAUDE.md`
//      never learns about is a convention nobody can follow.
//
// Those are asserted by reading source and docs together, in the spirit of
// this package's `packaging.test.ts` and `layerPolicy.test.ts`.
//
// The last two describes — Local development and Accepted costs — are
// weaker by nature, and deliberately so. Prose quality is not mechanically
// checkable, so they assert only that the subject is addressed under an
// explicit heading. They pass on a sentence that merely contains the word;
// what they catch is the section going missing entirely.

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const packagesDir = resolve(repoRoot, "packages");
const deploymentDocPath = resolve(repoRoot, "docs/deployment.md");
const claudeMdPath = resolve(repoRoot, ".claude/CLAUDE.md");

interface DiscoveredSetting {
  /** The workspace directory that reads it, e.g. `bot`. */
  package: string;
  /** The setting name, e.g. `MICROSOFT_APP_TENANT_ID`. */
  name: string;
}

/**
 * Every setting name that ships. Tests and `src/test/` are skipped: a
 * fixture naming a setting is not a deployment requirement, and this file
 * names several itself.
 */
function discoverSettings(): DiscoveredSetting[] {
  const found = new Map<string, DiscoveredSetting>();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const src = resolve(packagesDir, entry.name, "src");
    if (!entry.isDirectory() || !existsSync(src)) continue;

    const pkg = entry.name;
    const sources = readSourceFiles({
      root: src,
      exclude: (path) => path.startsWith("test/"),
    });

    for (const file of sources) {
      for (const name of file.text.match(SETTING_PATTERN) ?? []) {
        found.set(`${pkg}:${name}`, { package: pkg, name });
      }
    }
  }

  return [...found.values()].sort((a, b) =>
    `${a.package}:${a.name}`.localeCompare(`${b.package}:${b.name}`)
  );
}

describe("deployment documentation", () => {
  it("names every setting the source actually reads", () => {
    // A setting that exists only in code is the silent-failure case: the
    // Function App starts, the queue trigger binds to nothing, and the
    // first missing DM is the only evidence.
    const doc = readDoc(deploymentDocPath, "docs/deployment.md");
    const settings = discoverSettings();

    expect(settings.length).toBeGreaterThan(0);

    const undocumented = settings
      .filter(({ name }) => !doc.includes(name))
      .map(({ package: pkg, name }) => `${name} (read by packages/${pkg})`);

    expect(
      undocumented,
      `docs/deployment.md does not name these settings, so a fresh environment cannot be stood up from it:\n  ${undocumented.join("\n  ")}`
    ).toEqual([]);
  });

  it("documents the messaging endpoint at the route and auth level the function declares", () => {
    // The rationale is a claim about values `teamsMessages.ts` owns, so
    // both sides are read: the doc must describe the endpoint that
    // actually ships, not the one it shipped as when the doc was written.
    const source = readFileSync(
      resolve(packageRoot, "src/functions/teamsMessages/teamsMessages.ts"),
      "utf8"
    );

    const authLevel = source.match(/authLevel:\s*"([^"]+)"/)?.[1];
    const route = source.match(/route:\s*"([^"]+)"/)?.[1];

    expect(authLevel, "teamsMessages declares no authLevel").toBeTruthy();
    expect(route, "teamsMessages declares no route").toBeTruthy();
    expect(authLevel).toBe("anonymous");

    const doc = readDoc(deploymentDocPath, "docs/deployment.md");

    expect(
      doc,
      `deployment.md never names the messaging endpoint route (/api/${route as string})`
    ).toContain(`/api/${route as string}`);
    expect(
      doc,
      `deployment.md does not record that the endpoint is authLevel "${authLevel as string}"`
    ).toContain(authLevel as string);

    // What makes anonymous safe rather than open: the adapter validates
    // the Bot Framework JWT against app id, password and tenant on every
    // request. Recording "anonymous" without that reads as an oversight.
    for (const [subject, pattern] of [
      ["the Bot Framework token validation", /\b(JWT|bearer token|token)\b/i],
      ["the app id it validates against", /app id|MICROSOFT_APP_ID/i],
      ["the tenant it validates against", /tenant/i],
    ] as const) {
      expect(
        pattern.test(doc),
        `deployment.md documents an anonymous endpoint without ${subject} — the rationale is what stops this being flagged as a mistake in every future security review`
      ).toBe(true);
    }
  });

  it("names the sideloadable artifact the bot's package script produces", () => {
    // Sideloading is the install story, and the zip's name is its whole
    // contract — it is the file a teammate uploads to Teams.
    const pkg = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };

    const artifact = pkg.scripts?.package?.match(/([\w.-]+\.zip)/)?.[1];
    expect(
      artifact,
      "packages/bot's package script produces no .zip"
    ).toBeTruthy();

    const doc = readDoc(deploymentDocPath, "docs/deployment.md");

    expect(
      doc,
      `deployment.md never names ${artifact as string}, the artifact its own build produces`
    ).toContain(artifact as string);
    expect(
      /sideload/i.test(doc),
      "deployment.md does not cover sideloading, so the install story stops at the zip"
    ).toBe(true);
    expect(
      /Azure Bot|bot registration/i.test(doc),
      "deployment.md does not cover registering the Azure Bot resource"
    ).toBe(true);
  });

  it("documents the local development story under its own heading", () => {
    // Weak by construction — see the file header. It asserts the section
    // exists and addresses both halves, not that the steps are followable.
    const doc = readDoc(deploymentDocPath, "docs/deployment.md");
    const body = section(doc, /^#+\s.*local development/i);

    expect(
      body,
      "deployment.md has no local development section, so the bot cannot be exercised before it is deployed"
    ).toBeTruthy();

    for (const [subject, pattern] of [
      ["the Azurite queue emulator", /azurite/i],
      ["a tunnel to reach the messaging endpoint", /tunnel|ngrok/i],
    ] as const) {
      expect(
        pattern.test(body as string),
        `the local development section does not cover ${subject}`
      ).toBe(true);
    }
  });

  it("records the accepted costs under their own heading", () => {
    // Also weak by construction. These four are deliberate trades, and an
    // undocumented deliberate trade is indistinguishable from an
    // oversight to the next person to read the repo.
    const doc = readDoc(deploymentDocPath, "docs/deployment.md");
    const body = section(doc, /^#+\s.*accepted costs/i);

    expect(
      body,
      "deployment.md has no accepted-costs section, so its deliberate trades read as oversights"
    ).toBeTruthy();

    for (const [subject, pattern] of [
      [
        "two deploy targets",
        /two (Function Apps|deploy targets)|separate Function App|second Function App/i,
      ],
      ["two sets of app settings", /app settings/i],
      ["the queue envelope declared twice", /envelope/i],
      ["duplicate DMs being possible by design", /duplicate/i],
    ] as const) {
      expect(
        pattern.test(body as string),
        `the accepted-costs section does not record ${subject}`
      ).toBe(true);
    }

    // "Declared twice" is a fact about the source, so it is checked
    // rather than taken on the document's word — the two packages share
    // no code and no synchronous call, which is what forces the copy.
    const declarers = [
      resolve(
        packagesDir,
        "api/src/services/QueueNotificationPort/QueueNotificationPort.ts"
      ),
      resolve(packagesDir, "bot/src/lib/types/types.ts"),
    ].filter(
      (path) =>
        existsSync(path) &&
        /export interface NotificationMessage\b/.test(
          readFileSync(path, "utf8")
        )
    );

    expect(
      declarers.length,
      "the accepted-costs section records a duplicated queue envelope, but NotificationMessage is no longer declared in both packages"
    ).toBe(2);
  });
});

// `.claude/CLAUDE.md` is a deliberate local override and is gitignored, so
// a fresh clone does not have it. These three tests guard the AUTHOR's
// working copy against drift between the project instructions and the
// source — a real check, and the only place the bot's layer conventions are
// recorded, since design logs are immutable snapshots.
//
// They are skipped rather than failed when the file is absent. Failing
// would mean a clone cannot get the suite green; deleting them gives up
// the check; making them pass everywhere means force-adding a gitignored
// file, which is the author's call and not a test's. A clone was never
// given the file to drift from, so there is nothing there to assert
// against. In every working copy that HAS it, these run and still fail on
// real drift.
const projectInstructions = existsSync(claudeMdPath) ? describe : describe.skip;

projectInstructions(".claude/CLAUDE.md", () => {
  it("documents each setting under the package that reads it", () => {
    // Presence anywhere in the file is not enough. A setting listed only
    // under the package that does NOT read it tells someone configuring
    // the other Function App that they do not need it.
    const doc = readDoc(claudeMdPath, ".claude/CLAUDE.md");
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
    const doc = readDoc(claudeMdPath, ".claude/CLAUDE.md");
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
    const layers = readdirSync(resolve(packageRoot, "src"), {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== "test" &&
          existsSync(resolve(packageRoot, "src", entry.name, "index.ts"))
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
    const doc = readDoc(claudeMdPath, ".claude/CLAUDE.md");
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

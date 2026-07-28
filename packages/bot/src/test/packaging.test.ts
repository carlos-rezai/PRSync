import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The bot only exists for a teammate once it is a sideloadable
// `prsync-teams.zip`, and every way that silently fails is a file-level
// contract rather than runtime behaviour:
//
//   1. the manifest addresses an icon the zip does not contain — Teams
//      rejects the upload, or lists the app with a broken tile;
//   2. the manifest declares a scope this product has no surface for —
//      someone installs PRSync into a channel and it does nothing;
//   3. the icons are the wrong pixel size — Teams rejects the package.
//
// These assert those contracts directly, in the spirit of the extension's
// `src/test/packaging.test.ts`, so a broken package is caught in the suite
// rather than at install time. That `npm run package` itself emits a clean
// zip is verified by running it — a test would only re-implement `zip`.
//
// Manifest semantics are asserted against Microsoft's published schema
// (https://learn.microsoft.com/microsoftteams/platform/resources/schema/manifest-schema):
// `icons.color` is 192x192 and `icons.outline` is 32x32, a bot's `scopes`
// enum is personal | team | groupChat, and the required top-level fields
// are manifestVersion, version, id, developer, name, description, icons
// and accentColor.

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** The directory the `package` script zips into `prsync-teams.zip`. */
const teamsDir = resolve(packageRoot, "teams");
const manifestPath = resolve(teamsDir, "manifest.json");

/** Only the parts of the Teams manifest this package makes claims about. */
interface TeamsManifest {
  $schema?: string;
  manifestVersion?: string;
  id?: string;
  version?: string;
  packageName?: string;
  accentColor?: string;
  developer?: Record<string, string>;
  name?: { short?: string; full?: string };
  description?: { short?: string; full?: string };
  icons?: { color?: string; outline?: string };
  bots?: { botId?: string; scopes?: string[]; isNotificationOnly?: boolean }[];
  staticTabs?: { scopes?: string[] }[];
  configurableTabs?: { scopes?: string[] }[];
}

function readManifest(): TeamsManifest {
  expect(
    existsSync(manifestPath),
    `${manifestPath} is missing — there is no Teams app package to sideload`
  ).toBe(true);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as TeamsManifest;
}

/** Every path the manifest hands to Teams, which the zip must contain. */
function addressedPaths(manifest: TeamsManifest): string[] {
  return [manifest.icons?.color, manifest.icons?.outline].filter(
    (path): path is string => typeof path === "string"
  );
}

/**
 * A PNG's dimensions live in the IHDR chunk: an 8-byte signature, a 4-byte
 * length and the 4-byte "IHDR" type, then width and height as big-endian
 * uint32s at offsets 16 and 20.
 */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("Teams app package", () => {
  it("declares personal scope only", () => {
    // PRSync has no channel or group-chat surface. A bot installable into
    // one is an app that appears to work and then notifies nobody.
    const manifest = readManifest();

    expect(manifest.bots?.length ?? 0).toBeGreaterThan(0);
    for (const bot of manifest.bots ?? []) {
      expect(bot.scopes).toEqual(["personal"]);
    }

    // A configurable tab is by definition a channel/group-chat surface.
    expect(manifest.configurableTabs ?? []).toEqual([]);
    for (const tab of manifest.staticTabs ?? []) {
      expect(tab.scopes).toEqual(["personal"]);
    }
  });

  it("packages every path the manifest addresses", () => {
    const manifest = readManifest();
    const paths = addressedPaths(manifest);
    expect(paths.length).toBe(2);

    for (const path of paths) {
      // Teams resolves manifest paths relative to the zip root, so a path
      // that is absolute or climbs out of `teams/` cannot be shipped.
      expect(isAbsolute(path), `${path} is absolute, so the zip cannot ship it`).toBe(
        false
      );
      expect(
        path.split(/[\\/]/).includes(".."),
        `${path} escapes the packaged teams/ directory`
      ).toBe(false);
      expect(
        existsSync(resolve(teamsDir, path)),
        `${path} is addressed by the manifest but is not in packages/bot/teams/`
      ).toBe(true);
    }
  });

  it("references icons at the dimensions Teams requires", () => {
    // Teams requires a 192x192 full-bleed colour icon and a 32x32
    // white-on-transparent outline glyph; anything else is rejected at
    // upload. Both already exist at those sizes in the repo's `assets/`.
    const manifest = readManifest();

    const color = manifest.icons?.color;
    expect(color, "manifest declares no icons.color").toBeTruthy();
    expect(pngSize(resolve(teamsDir, color as string))).toEqual({
      width: 192,
      height: 192,
    });

    const outline = manifest.icons?.outline;
    expect(outline, "manifest declares no icons.outline").toBeTruthy();
    expect(pngSize(resolve(teamsDir, outline as string))).toEqual({
      width: 32,
      height: 32,
    });
  });

  it("pins manifestVersion to the schema it validates against", () => {
    // A manifest whose $schema and manifestVersion disagree validates
    // against one contract and is interpreted under another.
    const manifest = readManifest();

    expect(manifest.$schema).toMatch(
      /^https:\/\/developer\.microsoft\.com\/(en-us\/)?json-schemas\/teams\/v[\d.]+\/MicrosoftTeams\.schema\.json$/
    );
    expect(manifest.manifestVersion).toBeTruthy();
    expect(manifest.$schema).toContain(`/v${manifest.manifestVersion}/`);
  });

  it("registers a conversational bot, not a notification-only one", () => {
    // Deliberate, per the PRD: notification-only reads as the tighter
    // choice but costs the install-confirmation reply, the activity-driven
    // conversation-reference refresh, and forces a manifest change when v2
    // adds interactive card actions.
    const manifest = readManifest();

    for (const bot of manifest.bots ?? []) {
      expect(bot.isNotificationOnly ?? false).toBe(false);
    }
  });

  it("carries every field the Teams schema requires", () => {
    const manifest = readManifest();

    for (const field of [
      "manifestVersion",
      "version",
      "id",
      "developer",
      "name",
      "description",
      "icons",
      "accentColor",
    ] as const) {
      expect(manifest[field], `manifest is missing required field ${field}`).toBeTruthy();
    }

    for (const field of [
      "name",
      "websiteUrl",
      "privacyUrl",
      "termsOfUseUrl",
    ] as const) {
      expect(
        manifest.developer?.[field],
        `manifest.developer is missing required field ${field}`
      ).toBeTruthy();
    }

    // Teams identifies the app by GUID, and PRSync's accent colour backs
    // the outline glyph — both are pattern-constrained by the schema.
    expect(manifest.id).toMatch(
      /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/
    );
    expect(manifest.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// `packages/bot` shipped as a placeholder: `echo "not started yet"` scripts
// and an empty `src/`. Until it is a real workspace package it is invisible
// to the root `--workspaces` orchestration and to the commit gate, so it
// can rot without anything going red.

interface BotPackageJson {
  scripts?: Record<string, string>;
}

describe("bot workspace package", () => {
  it("runs the same build, test, lint and typecheck scripts as its siblings", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8")
    ) as BotPackageJson;

    for (const script of ["build", "test", "lint", "typecheck", "package"]) {
      const command = pkg.scripts?.[script];
      expect(command, `packages/bot has no ${script} script`).toBeTruthy();
      expect(
        command,
        `packages/bot's ${script} script is still the placeholder echo`
      ).not.toMatch(/not started yet/);
    }
  });

  it("produces prsync-teams.zip from its package script", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8")
    ) as BotPackageJson;

    // The zip's name is the sideloading contract — it is what a teammate
    // uploads to Teams. Whether `zip` itself works is verified by running
    // the script, not by re-implementing it here.
    const command = pkg.scripts?.package;
    expect(command, "packages/bot has no package script").toBeTruthy();
    expect(command).toContain("prsync-teams.zip");
  });

  it("is a real Azure Function App with a tsconfig extending the shared base", () => {
    expect(
      existsSync(resolve(packageRoot, "host.json")),
      "packages/bot has no host.json, so the Functions host has nothing to run"
    ).toBe(true);

    const tsconfigPath = resolve(packageRoot, "tsconfig.json");
    expect(
      existsSync(tsconfigPath),
      "packages/bot has no tsconfig.json"
    ).toBe(true);

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      extends?: string;
    };
    expect(tsconfig.extends).toBe("../../tsconfig.base.json");
  });
});

// A new package's lint errors must not be able to reach `main`. Two things
// have to hold for that, and issue #17 describes only the first:
//
//   1. the hook's lint step names no workspace — already true, since
//      issue #15 dropped `--workspace @prsync/extension` (commit 7fb2178);
//   2. `packages/bot` actually exposes a `lint` script, because the root
//      script fans out with `--workspaces --if-present` and silently skips
//      any package that has none.
//
// Asserting only (1) would report a gate that covers this package when it
// does not, so both are asserted together as the one behaviour that matters.

interface RootPackageJson {
  scripts?: Record<string, string>;
}

describe("commit gate", () => {
  it("reaches packages/bot", () => {
    const hook = readFileSync(resolve(repoRoot, ".husky/pre-commit"), "utf8");
    const lintStep = hook
      .split("\n")
      .find((line) => /^\s*npm run lint\b/.test(line));

    expect(lintStep, ".husky/pre-commit has no lint step").toBeTruthy();
    expect(
      lintStep,
      "the pre-commit lint step is scoped to a single workspace"
    ).not.toMatch(/--workspace\b/);

    const root = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    ) as RootPackageJson;
    expect(root.scripts?.lint).toContain("--workspaces");

    const pkg = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8")
    ) as BotPackageJson;
    expect(
      pkg.scripts?.lint,
      "packages/bot has no lint script, so --if-present skips it and the gate never lints this package"
    ).toBeTruthy();
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { section } from "../lib";
import { readDocument } from "../repo";
import { at, DEPLOYMENT, repoRoot } from "./documents";
import { discoverSettings } from "./settings";

// `docs/deployment.md` is the lookup document: it owns setting VALUES,
// the rationale behind them, and what each failure looks like. Nothing in
// it ships, so there is no behaviour to drive — what rots silently is the
// agreement between the document and the source it makes claims about:
//
//   1. a setting the code reads but no document names is a deploy that
//      comes up healthy and does nothing — the failure mode the whole
//      document exists to prevent;
//   2. the anonymous-endpoint rationale is a claim about a value
//      `teamsMessages.ts` owns. Change the value and the rationale
//      becomes a lie that reads as a considered decision.
//
// Both are asserted by reading source and docs together, in the spirit of
// `packages/bot`'s `packaging.test.ts` and `layerPolicy.test.ts`, which is
// where this file lived until the documentation got a workspace of its
// own.
//
// The last two describes — Local development and Accepted costs — are
// weaker by nature, and deliberately so. Prose quality is not mechanically
// checkable, so they assert only that the subject is addressed under an
// explicit heading. They pass on a sentence that merely contains the word;
// what they catch is the section going missing entirely.

const packagesDir = resolve(repoRoot, "packages");
// The bot is read as EVIDENCE here rather than as this workspace's own
// source, so it is named from the repo root like every other subject these
// tests read.
const botRoot = resolve(packagesDir, "bot");
const deploymentDocPath = at(DEPLOYMENT);

describe("deployment documentation", () => {
  it("names every setting the source actually reads", () => {
    // A setting that exists only in code is the silent-failure case: the
    // Function App starts, the queue trigger binds to nothing, and the
    // first missing DM is the only evidence.
    const doc = readDocument(deploymentDocPath, DEPLOYMENT);
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
      resolve(botRoot, "src/functions/teamsMessages/teamsMessages.ts"),
      "utf8"
    );

    const authLevel = source.match(/authLevel:\s*"([^"]+)"/)?.[1];
    const route = source.match(/route:\s*"([^"]+)"/)?.[1];

    expect(authLevel, "teamsMessages declares no authLevel").toBeTruthy();
    expect(route, "teamsMessages declares no route").toBeTruthy();
    expect(authLevel).toBe("anonymous");

    const doc = readDocument(deploymentDocPath, DEPLOYMENT);

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
      readFileSync(resolve(botRoot, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };

    const artifact = pkg.scripts?.package?.match(/([\w.-]+\.zip)/)?.[1];
    expect(
      artifact,
      "packages/bot's package script produces no .zip"
    ).toBeTruthy();

    const doc = readDocument(deploymentDocPath, DEPLOYMENT);

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
    const doc = readDocument(deploymentDocPath, DEPLOYMENT);
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
    const doc = readDocument(deploymentDocPath, DEPLOYMENT);
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

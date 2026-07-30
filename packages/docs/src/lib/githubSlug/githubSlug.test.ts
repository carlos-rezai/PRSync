import { describe, it, expect } from "vitest";
import { githubSlug } from "./githubSlug";

describe("GitHub heading slugs", () => {
  it("lowercases a heading and hyphenates its spaces", () => {
    expect(githubSlug("Deploying the bot")).toBe("deploying-the-bot");
    expect(githubSlug("Verifying a deploy")).toBe("verifying-a-deploy");
  });

  it("strips the punctuation GitHub strips rather than hyphenating it", () => {
    // Every left-hand side is a heading `docs/deployment.md` carries and
    // every right-hand side is an anchor `docs/setup-guide.md` links to.
    // A naive lowercase-and-hyphen pass turns the backticks and the slash
    // into hyphens and yields `why--api-messages--is-anonymous...`, which
    // resolves against nothing while LOOKING like a correct slug — which
    // is why the slugifier is worth a direct test rather than being left
    // to assertion 3 to imply.
    for (const [heading, slug] of [
      ["Prerequisite: bot configuration", "prerequisite-bot-configuration"],
      [
        "Prerequisite: the tables and the queue must already exist",
        "prerequisite-the-tables-and-the-queue-must-already-exist",
      ],
      [
        "Prerequisite: Function App CORS must allow the ADO org origin",
        "prerequisite-function-app-cors-must-allow-the-ado-org-origin",
      ],
      [
        "Why `/api/messages` is anonymous, and why that is not an open endpoint",
        "why-apimessages-is-anonymous-and-why-that-is-not-an-open-endpoint",
      ],
      [
        "Packaging and sideloading the Teams app",
        "packaging-and-sideloading-the-teams-app",
      ],
    ] as const) {
      expect(githubSlug(heading), heading).toBe(slug);
    }
  });

  it("leaves the gap an em-dash vacated, as two hyphens", () => {
    // The one rule that looks like a bug and is not. GitHub drops the
    // em-dash and then hyphenates both surviving spaces, so every heading
    // in this repo's house style slugs with a DOUBLE hyphen. An
    // implementation that tidies runs of hyphens away is wrong for every
    // stage heading in the setup guide at once.
    expect(
      githubSlug("Stage 4 — Messaging endpoint and the Teams channel")
    ).toBe("stage-4--messaging-endpoint-and-the-teams-channel");
    expect(githubSlug("Stage 1 — Storage: three tables and one queue")).toBe(
      "stage-1--storage-three-tables-and-one-queue"
    );
    expect(githubSlug("PRSync — Setup guide")).toBe("prsync--setup-guide");
  });
});

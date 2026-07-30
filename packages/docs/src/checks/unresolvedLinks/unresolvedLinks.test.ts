import { describe, it, expect } from "vitest";
import { fakeRepo } from "../../test/fixtures/fakes";
import { unresolvedLinks, type UnresolvedLink } from "./unresolvedLinks";

// Every case here is driven against a fake repository, which is the whole
// reason the `Repo` port exists: "reports a link to a missing file" and
// "reports an anchor matching no heading" are what this check must be able
// to do, and are exactly what the real repo, being correct, cannot
// demonstrate.

/** Unresolved links as one line each, so a failure reads like a linter. */
function report(hits: readonly UnresolvedLink[]): string[] {
  return hits.map(
    ({ document, line, target, reason }) =>
      `${document}:${line} ${target} — ${reason}`
  );
}

describe("the link resolver", () => {
  it("reports a relative link whose file does not exist", () => {
    const repo = fakeRepo({
      "docs/setup-guide.md": "Values live in [`deployment.md`](deployment.md).",
    });

    expect(
      report(unresolvedLinks({ documents: ["docs/setup-guide.md"], repo }))
    ).toEqual(["docs/setup-guide.md:1 deployment.md — no such file"]);
  });

  it("reports an anchor that matches no heading in the target document", () => {
    // The half that rots without anyone noticing: the file is still
    // there, so the link still renders, and the reader lands at the top
    // of a 600-line reference instead of at the paragraph they were sent
    // to.
    const repo = fakeRepo({
      "docs/setup-guide.md":
        "The publish command is in [Deploying the bot](deployment.md#deploying-the-bot).",
      "docs/deployment.md": "# Deployment\n\n## Deploying the API\n",
    });

    expect(
      report(unresolvedLinks({ documents: ["docs/setup-guide.md"], repo }))
    ).toEqual([
      "docs/setup-guide.md:1 deployment.md#deploying-the-bot — no such heading",
    ]);
  });

  it("passes a link whose file and heading both resolve", () => {
    const repo = fakeRepo({
      "docs/setup-guide.md":
        "The publish command is in [Deploying the bot](deployment.md#deploying-the-bot).",
      "docs/deployment.md": "# Deployment\n\n## Deploying the bot\n",
    });

    expect(
      report(unresolvedLinks({ documents: ["docs/setup-guide.md"], repo }))
    ).toEqual([]);
  });

  it("resolves a bare anchor against the linking document's own headings", () => {
    const repo = fakeRepo({
      "docs/user-guide.md": [
        "# PRSync — User guide",
        "",
        "Jump to [Install PRSync](#install-prsync) or [the panel](#the-panel).",
        "",
        "## Install PRSync",
      ].join("\n"),
    });

    expect(
      report(unresolvedLinks({ documents: ["docs/user-guide.md"], repo }))
    ).toEqual(["docs/user-guide.md:3 #the-panel — no such heading"]);
  });

  it("resolves each destination relative to the document it is written in", () => {
    // `README.md` and `docs/setup-guide.md` both link the deployment
    // reference, and they must spell it differently. Resolving every
    // destination from the repo root instead passes the README's link and
    // silently passes the guide's too, which is the bug that makes a link
    // checker worthless.
    const repo = fakeRepo({
      "README.md": "Stand it up with [the setup guide](docs/setup-guide.md).",
      "docs/setup-guide.md":
        "Values live in [`deployment.md`](docs/deployment.md).",
      "docs/deployment.md": "# Deployment",
    });

    expect(
      report(
        unresolvedLinks({
          documents: ["README.md", "docs/setup-guide.md"],
          repo,
        })
      )
    ).toEqual(["docs/setup-guide.md:1 docs/deployment.md — no such file"]);
  });

  it("ignores destinations that are not repo-relative paths", () => {
    // The README is mostly outbound links, and the resolver takes no
    // position on the web. A leading slash is site-root relative rather
    // than repo-relative, so it is left alone for the same reason — no
    // document in this repo writes one.
    const repo = fakeRepo({
      "README.md": [
        "Under [AI Unified Process](https://unifiedprocess.ai/) (AIUP),",
        "install [Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local),",
        "mail [someone](mailto:someone@example.com),",
        "or read [the guide](/docs/user-guide.md).",
      ].join("\n"),
    });

    expect(report(unresolvedLinks({ documents: ["README.md"], repo }))).toEqual(
      []
    );
  });

  it("does not read a heading inside a fenced code block as a heading", () => {
    // `docs/deployment.md` carries exactly this shape: a shell fence
    // whose `# 1. Build the panel` comment is a comment, not a heading.
    // Reading it as one invents an anchor that renders as a dead link
    // while the test that should have caught it goes green.
    const repo = fakeRepo({
      "docs/setup-guide.md": [
        "Read [Packaging](deployment.md#packaging-and-publishing-the-extension),",
        "then run [the numbered steps](deployment.md#1-build-the-panel).",
      ].join("\n"),
      "docs/deployment.md": [
        "# Deployment",
        "",
        "## Packaging and publishing the extension",
        "",
        "```",
        "# 1. Build the panel (see above).",
        "```",
      ].join("\n"),
    });

    expect(
      report(unresolvedLinks({ documents: ["docs/setup-guide.md"], repo }))
    ).toEqual([
      "docs/setup-guide.md:2 deployment.md#1-build-the-panel — no such heading",
    ]);
  });

  it("passes a link to a directory", () => {
    // The README links the card templates as a folder. Existence is the
    // whole question for an unanchored destination, and a directory
    // answers it.
    const repo = fakeRepo({
      "README.md": "- [Adaptive Card Templates](docs/handoff/adaptive-cards)",
      "docs/handoff/adaptive-cards": "",
    });

    expect(report(unresolvedLinks({ documents: ["README.md"], repo }))).toEqual(
      []
    );
  });

  it("takes the document set as data, so adding a document changes no signature", () => {
    // The interface property, driven rather than asserted about: the same
    // call checks one document or three, and every hit names the document
    // it was written in. A sixth document is one more string in the
    // registry's CROSS_REFERENCED.
    const repo = fakeRepo({
      "README.md": "[gone](docs/nowhere.md)",
      "docs/setup-guide.md": "[gone](nowhere.md)",
      "docs/user-guide.md": "[gone](../nowhere.md)",
    });

    expect(report(unresolvedLinks({ documents: ["README.md"], repo }))).toEqual(
      ["README.md:1 docs/nowhere.md — no such file"]
    );

    expect(
      report(
        unresolvedLinks({
          documents: ["README.md", "docs/setup-guide.md", "docs/user-guide.md"],
          repo,
        })
      )
    ).toEqual([
      "README.md:1 docs/nowhere.md — no such file",
      "docs/setup-guide.md:1 nowhere.md — no such file",
      "docs/user-guide.md:1 ../nowhere.md — no such file",
    ]);
  });
});

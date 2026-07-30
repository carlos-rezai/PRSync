import { describe, it, expect } from "vitest";
import { fakeRepo } from "../../test/fixtures/fakes";
import { unreachable } from "./reachable";

describe("unreachable", () => {
  it("reaches a document the front door links directly", () => {
    const repo = fakeRepo({
      "README.md": "Start with [the setup guide](docs/setup-guide.md).",
      "docs/setup-guide.md": "# Setup",
    });

    expect(
      unreachable({
        from: "README.md",
        documents: ["docs/setup-guide.md"],
        repo,
      })
    ).toEqual([]);
  });

  it("reaches a document linked only from a linked document", () => {
    // Reachability is TRANSITIVE, which is the whole point: the README is
    // not required to link everything itself, only to be the root of a
    // tree that covers everything. A reader routed to the setup guide can
    // get to what the setup guide links.
    const repo = fakeRepo({
      "README.md": "Start with [the setup guide](docs/setup-guide.md).",
      "docs/setup-guide.md": "Values live in [deployment](deployment.md).",
      "docs/deployment.md": "# Deployment",
    });

    expect(
      unreachable({
        from: "README.md",
        documents: ["docs/setup-guide.md", "docs/deployment.md"],
        repo,
      })
    ).toEqual([]);
  });

  it("reports a document nothing links to", () => {
    // The failure this check exists for, and the one the link resolver
    // cannot see: every link that exists resolves, and the orphan is still
    // an orphan.
    const repo = fakeRepo({
      "README.md": "Start with [the setup guide](docs/setup-guide.md).",
      "docs/setup-guide.md": "# Setup",
      "docs/orphan.md": "# Nobody links here",
    });

    expect(
      unreachable({
        from: "README.md",
        documents: ["docs/setup-guide.md", "docs/orphan.md"],
        repo,
      })
    ).toEqual(["docs/orphan.md"]);
  });

  it("terminates on a cycle", () => {
    // The two guides link each other, and the README links both. A walk
    // that did not remember where it had been would not finish.
    const repo = fakeRepo({
      "README.md": "[a](docs/a.md)",
      "docs/a.md": "[b](b.md)",
      "docs/b.md": "[a](a.md)",
    });

    expect(
      unreachable({
        from: "README.md",
        documents: ["docs/a.md", "docs/b.md"],
        repo,
      })
    ).toEqual([]);
  });

  it("does not route through a link inside a fenced code block", () => {
    // A path written in a shell example is not a route a reader can take,
    // and treating it as one would mark a genuine orphan as reachable.
    const repo = fakeRepo({
      "README.md": ["```bash", "cat [docs](docs/orphan.md)", "```"].join("\n"),
      "docs/orphan.md": "# Nobody links here",
    });

    expect(
      unreachable({ from: "README.md", documents: ["docs/orphan.md"], repo })
    ).toEqual(["docs/orphan.md"]);
  });

  it("does not route through an outbound URL", () => {
    const repo = fakeRepo({
      "README.md": "See [the process](https://unifiedprocess.ai/).",
      "docs/orphan.md": "# Nobody links here",
    });

    expect(
      unreachable({ from: "README.md", documents: ["docs/orphan.md"], repo })
    ).toEqual(["docs/orphan.md"]);
  });

  it("reaches a document through an anchored link", () => {
    // `deployment.md#accepted-costs` is a route to `deployment.md`. The
    // anchor says where in it to land, not which document it is.
    const repo = fakeRepo({
      "README.md": "[costs](docs/deployment.md#accepted-costs)",
      "docs/deployment.md": "# Deployment\n\n## Accepted costs",
    });

    expect(
      unreachable({
        from: "README.md",
        documents: ["docs/deployment.md"],
        repo,
      })
    ).toEqual([]);
  });

  it("counts the front door itself as reached", () => {
    expect(
      unreachable({
        from: "README.md",
        documents: ["README.md"],
        repo: fakeRepo({ "README.md": "# PRSync" }),
      })
    ).toEqual([]);
  });
});

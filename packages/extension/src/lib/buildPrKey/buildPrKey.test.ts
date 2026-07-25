import { describe, it, expect } from "vitest";
import { buildPrKey } from "./buildPrKey";

// A client copy of the API's PR key builder. The panel and the API must
// produce byte-identical keys — the key is the contract both sides share
// (Table Storage partition key). Format: `{guid}:{guid}:{int}`, matching
// packages/api/src/lib/prKey exactly. See docs/ubiquitous-language.md
// ("PR key").

const PROJECT_ID = "6f5e4d3c-2b1a-0908-1716-2524232221f0";
const REPO_ID = "aabbccdd-eeff-0011-2233-445566778899";

// Mirror of the API's PR key regex — two GUIDs and a positive integer.
const GUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const PR_KEY_RE = new RegExp(`^(${GUID}):(${GUID}):([1-9][0-9]*)$`);

describe("buildPrKey", () => {
  it("joins the two GUIDs and the PR id with colons", () => {
    expect(
      buildPrKey({
        projectId: PROJECT_ID,
        repositoryId: REPO_ID,
        pullRequestId: 42,
      })
    ).toBe(`${PROJECT_ID}:${REPO_ID}:42`);
  });

  it("produces a key in the exact {guid}:{guid}:{int} format the API accepts", () => {
    const key = buildPrKey({
      projectId: PROJECT_ID,
      repositoryId: REPO_ID,
      pullRequestId: 7,
    });
    expect(PR_KEY_RE.test(key)).toBe(true);
  });

  it("uses the PR id verbatim for multi-digit ids", () => {
    expect(
      buildPrKey({
        projectId: PROJECT_ID,
        repositoryId: REPO_ID,
        pullRequestId: 1234,
      })
    ).toBe(`${PROJECT_ID}:${REPO_ID}:1234`);
  });
});

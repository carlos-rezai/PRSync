import { describe, it, expect } from "vitest";
import { buildPrKey, parsePrKey, isValidPrKey } from "./prKey";

// PR key = `{projectId}:{repositoryId}:{pullRequestId}` — two GUIDs and a
// positive integer. It is the Table Storage partition key, so a raw PR
// number (unique only within a repo) is never enough.

const PROJECT = "6f5e4d3c-2b1a-0908-1716-2524232221f0";
const REPO = "aabbccdd-eeff-0011-2233-445566778899";
const PR_ID = 42;
const VALID_KEY = `${PROJECT}:${REPO}:${PR_ID}`;

describe("buildPrKey", () => {
  it("joins project, repository, and pull-request id into the composite key", () => {
    expect(
      buildPrKey({
        projectId: PROJECT,
        repositoryId: REPO,
        pullRequestId: PR_ID,
      })
    ).toBe(VALID_KEY);
  });
});

describe("parsePrKey", () => {
  it("round-trips a key built by buildPrKey back to its parts", () => {
    const parts = {
      projectId: PROJECT,
      repositoryId: REPO,
      pullRequestId: PR_ID,
    };
    expect(parsePrKey(buildPrKey(parts))).toEqual(parts);
  });

  it("parses the pull-request id as a number, not a string", () => {
    expect(parsePrKey(VALID_KEY).pullRequestId).toBe(42);
  });

  it.each([
    ["empty string", ""],
    ["not a key at all", "not-a-key"],
    ["missing the pull-request id", `${PROJECT}:${REPO}`],
    ["non-guid project", `xyz:${REPO}:42`],
    ["non-guid repository", `${PROJECT}:not-a-guid:42`],
    ["non-numeric pull-request id", `${PROJECT}:${REPO}:abc`],
    ["non-positive pull-request id", `${PROJECT}:${REPO}:0`],
    ["negative pull-request id", `${PROJECT}:${REPO}:-3`],
    ["fractional pull-request id", `${PROJECT}:${REPO}:1.5`],
    ["extra trailing segment", `${PROJECT}:${REPO}:42:extra`],
  ])("rejects a malformed key (%s)", (_label, bad) => {
    expect(() => parsePrKey(bad)).toThrow();
  });
});

describe("isValidPrKey", () => {
  it("accepts a well-formed key", () => {
    expect(isValidPrKey(VALID_KEY)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["not-a-key", "garbage"],
    [`${PROJECT}:${REPO}`, "missing pr id"],
    [`${PROJECT}:not-a-guid:42`, "non-guid repo"],
    [`${PROJECT}:${REPO}:0`, "non-positive pr id"],
  ])("rejects a malformed key: %s (%s)", (bad) => {
    expect(isValidPrKey(bad)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { fakeRepo } from "../../test/fixtures/fakes";
import { surfaceLabel, surfaceText } from "./surfaceText";

describe("surfaceText", () => {
  it("reads a markdown surface whole and a JSON surface's value", () => {
    const repo = fakeRepo({
      "docs/user-guide.md": "# User guide\n\nQuorum closes a round.",
      "m.json": JSON.stringify({ description: { full: "Quorum, not all." } }),
    });

    expect(surfaceText({ path: "docs/user-guide.md" }, repo)).toBe(
      "# User guide\n\nQuorum closes a round."
    );
    expect(
      surfaceText({ path: "m.json", field: "description.full" }, repo)
    ).toBe("Quorum, not all.");
  });

  it("gives the same answer however the JSON is formatted", () => {
    // The property that makes scanning a manifest safe to leave in the
    // suite: the manifests are formatted by Prettier and their indentation
    // is not a decision anyone makes. A check against raw text moves its
    // line numbers on a reformat and eventually gets deleted for crying
    // wolf.
    const value = "It closes on quorum.";

    for (const json of [
      JSON.stringify({ description: { full: value } }, null, 2),
      JSON.stringify({ description: { full: value } }),
    ]) {
      expect(
        surfaceText(
          { path: "m.json", field: "description.full" },
          fakeRepo({ "m.json": json })
        )
      ).toBe(value);
    }
  });

  it("reads only the field it was given, not its siblings", () => {
    // The whole reason a manifest is read as JSON. `description.short` is a
    // sibling the scan was not pointed at, and a raw-text read of the same
    // file returns it too — which would make an assertion unfixable without
    // editing a field nobody asked about.
    const repo = fakeRepo({
      "m.json": JSON.stringify({
        description: { short: "Short.", full: "Full." },
      }),
    });

    expect(
      surfaceText({ path: "m.json", field: "description.full" }, repo)
    ).toBe("Full.");
  });

  it("yields nothing, rather than throwing, every way there is nothing to read", () => {
    // What a vacuously green scan looks like from the inside: rename the
    // field and there is nothing to scan. It returns no text rather than
    // throwing, because the caller's floor reports "this surface is empty"
    // by name, which is a better failure than a parse trace from in here.
    const repo = fakeRepo({
      "m.json": JSON.stringify({ description: { summary: "quorum" } }),
      "broken.json": "{ not json",
      "nested.json": JSON.stringify({ description: { full: { en: "hi" } } }),
    });

    for (const surface of [
      // A field that has been renamed.
      { path: "m.json", field: "description.full" },
      // A file that is not JSON at all.
      { path: "broken.json", field: "description" },
      // A field that resolves to an object, not a string: there is no
      // sentence there to check.
      { path: "nested.json", field: "description.full" },
      // A path that is not there.
      { path: "absent.json", field: "description" },
    ]) {
      expect(surfaceText(surface, repo), surface.path).toBe("");
    }
  });
});

describe("surfaceLabel", () => {
  it("names a document by path and a JSON field by path#field", () => {
    expect(surfaceLabel({ path: "README.md" })).toBe("README.md");
    expect(surfaceLabel({ path: "m.json", field: "description.full" })).toBe(
      "m.json#description.full"
    );
  });
});

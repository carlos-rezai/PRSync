import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readDocument } from "./readDocument";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

describe("readDocument", () => {
  it("reads a document's full text", () => {
    expect(readDocument(resolve(repoRoot, "README.md"), "README.md")).toContain(
      "PRSync"
    );
  });

  it("names the missing document by its repo-root path", () => {
    // The label is the whole feature, so it is what the test asserts. The
    // path passed in is absolute and contains whoever's home directory ran
    // the suite; the label is what the reader's editor calls the file.
    expect(() =>
      readDocument(resolve(repoRoot, "docs/gone.md"), "docs/gone.md")
    ).toThrow("docs/gone.md is missing");
  });
});

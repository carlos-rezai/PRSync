import { describe, it, expect } from "vitest";
import { section } from "./section";

// `section` is what makes the Environment Variables check work at all, and
// until now it had no test of its own — it was exercised only as a side
// effect of asserting something else, which is exactly the shape that
// leaves a bug invisible until the assertion it serves goes quiet.

const DOC = [
  "# Deployment",
  "",
  "Intro.",
  "",
  "## Environment variables",
  "",
  "```bash",
  "# packages/api",
  "AZURE_TABLES_CONNECTION_STRING=",
  "",
  "# packages/bot",
  "MICROSOFT_APP_ID=",
  "```",
  "",
  "### A subsection, which does not end it",
  "",
  "More.",
  "",
  "## Accepted costs",
  "",
  "Trades.",
].join("\n");

describe("section", () => {
  it("returns the body up to the next same-level heading", () => {
    const body = section(DOC, /^#+\s+Accepted costs/);

    expect(body).toBe("\nTrades.");
  });

  it("does not end a section at a deeper heading", () => {
    // `###` under a `##` is part of that `##`, which is what lets a
    // section be read whole rather than down to its first subheading.
    const body = section(DOC, /^#+\s+Environment variables/) as string;

    expect(body).toContain("A subsection, which does not end it");
    expect(body).toContain("More.");
    expect(body).not.toContain("Trades.");
  });

  it("does not end a section at a heading inside a fence", () => {
    // The case that motivated the fence-awareness. `# packages/api` is a
    // shell comment; read as a `#` heading it is HIGHER than the `##`
    // section, so the body ends before a single setting is seen and the
    // whole check goes vacuously green.
    const body = section(DOC, /^#+\s+Environment variables/) as string;

    expect(body).toContain("AZURE_TABLES_CONNECTION_STRING=");
    expect(body).toContain("MICROSOFT_APP_ID=");
  });

  it("runs to the end of the document when no heading follows", () => {
    expect(section("## Only\n\nBody.", /^#+\s+Only/)).toBe("\nBody.");
  });

  it("answers undefined for a heading that is not there", () => {
    // Distinguishable from an empty section on purpose: "the section is
    // gone" and "the section is empty" are different failures, and every
    // caller reports the first one by name.
    expect(section(DOC, /^#+\s+Local development/)).toBeUndefined();
  });

  it("does not match a heading written inside a fence", () => {
    // The other half of fence-awareness: not just where a section ENDS,
    // but where one is allowed to start.
    expect(section("```\n## Fenced\n```\n", /^#+\s+Fenced/)).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { SETTING_PATTERN, settingTokens, withoutLinks } from "./settingTokens";

// The three belong in one module because the pattern means nothing without
// the link-stripping rule: `docs/deployment.md` owns setting VALUES and the
// setup guide owns ORDER, so the guide must be able to send a reader to a
// setting without carrying a second copy of the table that describes it. A
// link is what that pointer looks like.

describe("withoutLinks", () => {
  it("removes a markdown link's text and its destination", () => {
    expect(
      withoutLinks("Set [`MICROSOFT_APP_ID`](deployment.md#bot-configuration).")
    ).toBe("Set  .");
  });

  it("removes an autolink", () => {
    expect(withoutLinks("See <https://example.com/VITE_API_BASE_URL>.")).toBe(
      "See  ."
    );
  });

  it("leaves prose alone", () => {
    expect(withoutLinks("Set MICROSOFT_APP_TYPE to SingleTenant.")).toBe(
      "Set MICROSOFT_APP_TYPE to SingleTenant."
    );
  });
});

describe("settingTokens", () => {
  it("allows a setting that is pointed at by a link", () => {
    // The allowance is what makes the rule followable rather than a ban on
    // ever mentioning configuration: the guide has to send the reader
    // somewhere.
    expect(
      settingTokens(
        "Then set [`MICROSOFT_APP_ID`](deployment.md#prerequisite-bot-configuration)."
      )
    ).toEqual([]);
  });

  it("reports a setting named as prose or as a code span", () => {
    // Code spans are deliberately not exempt: a backticked setting name is
    // the exact shape the duplicated configuration table would take.
    for (const naming of [
      "Set `MICROSOFT_APP_TYPE` to SingleTenant.",
      "AZURE_QUEUES_CONNECTION_STRING is required.",
      "Optionally override PRSYNC_DEFAULT_QUORUM.",
      "The build reads VITE_API_BASE_URL.",
    ]) {
      expect(
        settingTokens(naming),
        `the link allowance is swallowing a setting named outside one: ${naming}`
      ).not.toEqual([]);
    }
  });

  it("names the token, its 1-based line and the line as written", () => {
    // A failure has to read like a linter — a line a reader can jump to.
    expect(
      settingTokens("# Setup\n\nAZURE_TABLES_CONNECTION_STRING is required.")
    ).toEqual([
      {
        token: "AZURE_TABLES_CONNECTION_STRING",
        line: 3,
        text: "AZURE_TABLES_CONNECTION_STRING is required.",
      },
    ]);
  });

  it("reports every setting on one line, not just the first", () => {
    expect(
      settingTokens("Set MICROSOFT_APP_ID and MICROSOFT_APP_PASSWORD.").map(
        ({ token }) => token
      )
    ).toEqual(["MICROSOFT_APP_ID", "MICROSOFT_APP_PASSWORD"]);
  });

  it("finds nothing in a document that names no setting", () => {
    expect(settingTokens("# User guide\n\nA round closes on quorum.")).toEqual(
      []
    );
  });
});

describe("SETTING_PATTERN", () => {
  it("gives the same answer however often it is used", () => {
    // The `g` flag makes `lastIndex` stateful, and two spec files plus
    // `settingTokens` share this one regex. `String.prototype.match` resets
    // it; `.test()` and `.exec()` would resume from wherever the previous
    // caller left off and skip half the lines in the document.
    const line = "MICROSOFT_APP_ID and PRSYNC_DEFAULT_QUORUM";

    expect(line.match(SETTING_PATTERN)).toEqual(line.match(SETTING_PATTERN));
  });
});

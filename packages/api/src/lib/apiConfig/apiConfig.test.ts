import { describe, it, expect } from "vitest";
import { DEFAULT_QUORUM, readApiConfig } from "./apiConfig";

// Everything the API needs from its environment, read in one place at
// host start rather than at the first request that happens to need it.
//
// The two settings fail in opposite directions, which is the whole reason
// this is a function with tests rather than two `process.env` reads in the
// composition root:
//
//   - The connection string is absent or it is not. A missing one has no
//     sane fallback, and the failure it produces lazily — every request
//     500ing from inside the storage layer — names nothing an operator
//     can act on. So it throws at start, naming the setting.
//   - The quorum has a documented default of 2 and is therefore usually
//     unset. What it must never do is default SILENTLY past a value the
//     operator did set: `PRSYNC_DEFAULT_QUORUM=0` or `=two` shipping as 2
//     is a round-closing rule quietly not being the one that was
//     configured, and nothing downstream can tell the difference.
//
// Mirrors `readBotConfig` in packages/bot, for the same reason: a setting
// that fails loudly at start beats one that fails subtly forever.

const CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=prsync;AccountKey=a2V5;";

const COMPLETE_ENV = {
  AZURE_TABLES_CONNECTION_STRING: CONNECTION_STRING,
} as const;

describe("readApiConfig", () => {
  it("reads the Table Storage connection string the repository needs", () => {
    expect(readApiConfig({ ...COMPLETE_ENV })).toMatchObject({
      tablesConnectionString: CONNECTION_STRING,
    });
  });

  it("defaults the quorum to 2 when nothing is configured", () => {
    // The documented default, and the one the round lifecycle was
    // designed around: a round closes on two Done signals, not unanimity
    // (docs/ubiquitous-language.md, "Quorum").
    expect(DEFAULT_QUORUM).toBe(2);
    expect(readApiConfig({ ...COMPLETE_ENV })).toMatchObject({
      defaultQuorum: 2,
    });
    // Blank is unset: an App Service setting with its value cleared and
    // one that was never added are the same act, and there is nothing for
    // a distinction between them to mean.
    for (const value of [undefined, "", "   "]) {
      expect(
        readApiConfig({ ...COMPLETE_ENV, PRSYNC_DEFAULT_QUORUM: value }),
        `${JSON.stringify(value)} did not fall back to the default`
      ).toMatchObject({ defaultQuorum: 2 });
    }
  });

  it("reads a configured quorum", () => {
    expect(
      readApiConfig({ ...COMPLETE_ENV, PRSYNC_DEFAULT_QUORUM: "3" })
    ).toMatchObject({ defaultQuorum: 3 });
  });

  it("refuses to start when the connection string is missing or blank, naming it", () => {
    // Named, because the operator reading the failure is looking at an
    // App Service configuration blade, not at this file.
    for (const value of [undefined, "", "   "]) {
      expect(() =>
        readApiConfig({ AZURE_TABLES_CONNECTION_STRING: value }),
        `${JSON.stringify(value)} was accepted as a connection string`
      ).toThrowError("AZURE_TABLES_CONNECTION_STRING");
    }
  });

  it("refuses a quorum that is not a whole number of reviewers, naming it", () => {
    // Every one of these is a value someone typed on purpose. Falling
    // back to 2 would leave the round-closing rule silently different
    // from the configured one, which no test downstream could catch.
    for (const value of ["0", "-1", "1.5", "two", "2 reviewers", "1e1"]) {
      expect(() =>
        readApiConfig({ ...COMPLETE_ENV, PRSYNC_DEFAULT_QUORUM: value }),
        `"${value}" was accepted as a quorum`
      ).toThrowError("PRSYNC_DEFAULT_QUORUM");
    }
  });
});

import { describe, it, expect } from "vitest";
import { fakeRepo } from "../../test/fixtures/fakes";
import { unanimityAliases, type UnanimityHit } from "./unanimityAliases";
import type { Surface } from "../surfaceText/surfaceText";

/** Alias hits as one line each, so a failure reads like a linter. */
function aliasReport(hits: readonly UnanimityHit[]): string[] {
  return hits.map(
    ({ surface, line, alias, text }) => `${surface}:${line} ${alias} — ${text}`
  );
}

/** A manifest carrying `description.short` and `description.full`. */
function manifestWith(description: {
  short: string;
  full: string;
}): Record<string, string> {
  return {
    "teams/manifest.json": JSON.stringify({ description }, null, 2),
  };
}

/** The Teams app description, the one surface that shipped wrong. */
const TEAMS_DESCRIPTION: Surface = {
  path: "packages/bot/teams/manifest.json",
  field: "description.full",
};

describe("the unanimity scanner", () => {
  it("reads a JSON field's value, and only the field it was given", () => {
    // The whole reason a manifest is read as JSON. `description.short`
    // here is a sibling the scan was not pointed at, and a raw-text scan
    // of the same file reports it — which would make the assertion
    // unfixable without editing a field nobody asked about.
    const repo = fakeRepo(
      manifestWith({
        short: "Tells the author when all reviewers are done.",
        full: "PRSync closes a round the moment it reaches quorum.",
      })
    );

    const surface: Surface = {
      path: "teams/manifest.json",
      field: "description.full",
    };

    expect(
      aliasReport(unanimityAliases({ surfaces: [surface], repo }))
    ).toEqual([]);

    // Pointed at the sibling instead it reports — so the clean result
    // above is the field being read, not the scan finding nothing.
    expect(
      aliasReport(
        unanimityAliases({
          surfaces: [{ ...surface, field: "description.short" }],
          repo,
        })
      )
    ).toEqual([
      "teams/manifest.json#description.short:1 all reviewers — Tells the author when all reviewers are done.",
    ]);
  });

  it("catches the sentence the Teams manifest actually shipped", () => {
    // Not a hypothetical: this is `description.full` as committed, and it
    // is the sentence in front of every person installing the Teams app.
    // "the last reviewer" is listed as a unanimity alias in
    // `docs/ubiquitous-language.md` alongside "everyone" and "consensus",
    // and a scanner that misses it goes green over the one surface this
    // slice exists to correct.
    const shipped =
      "When an author marks a pull request ready for review, PRSync sends each reviewer on that round a direct message; when the last reviewer marks themselves done and the round closes, it tells the author.";

    expect(
      aliasReport(
        unanimityAliases({
          surfaces: [TEAMS_DESCRIPTION],
          repo: fakeRepo({
            [TEAMS_DESCRIPTION.path]: JSON.stringify({
              description: { full: shipped },
            }),
          }),
        })
      )
    ).toEqual([
      `packages/bot/teams/manifest.json#description.full:1 the last reviewer — ${shipped}`,
    ]);
  });

  it("names every alias the ubiquitous language lists", () => {
    // The vocabulary, driven one sentence at a time. Each of these
    // describes a close rule PRSync does not have, and each is the
    // natural, friendly way to write the sentence — which is why the
    // list is worth pinning rather than trusting to one regex.
    for (const [sentence, alias] of [
      ["The round closes when everyone has finished.", "everyone"],
      ["A round closes on consensus.", "consensus"],
      ["Rounds close unanimously.", "unanimous"],
      ["It closes once all reviewers are done.", "all reviewers"],
      ["The author hears back once the team has signed off.", "signed off"],
      ["The round closes when the change is approved.", "approved"],
      [
        "It tells the author when the last reviewer marks themselves done.",
        "the last reviewer",
      ],
    ] as const) {
      const hits = unanimityAliases({
        surfaces: [{ path: "surface.md" }],
        repo: fakeRepo({ "surface.md": sentence }),
      });

      expect(
        hits.map(({ alias: named }) => named),
        sentence
      ).toContain(alias);
    }
  });

  it("reports a markdown surface by line, 1-based", () => {
    // The README is the one derived surface that is a document, and a
    // failure has to name a line a reader can jump to.
    const repo = fakeRepo({
      "README.md": [
        "# PRSync",
        "",
        "The round closes when everyone has finished reviewing.",
      ].join("\n"),
    });

    expect(
      aliasReport(unanimityAliases({ surfaces: [{ path: "README.md" }], repo }))
    ).toEqual([
      "README.md:3 everyone — The round closes when everyone has finished reviewing.",
    ]);
  });

  it("gives the same answer however the JSON is formatted", () => {
    // The property that makes scanning a manifest safe to leave in the
    // suite: the manifests are formatted by Prettier and their indentation
    // is not a decision anyone makes. A check against raw text moves its
    // line numbers on a reformat and eventually gets deleted for crying
    // wolf.
    const value = "It closes when the last reviewer is done.";
    const expected = [`m.json#description.full:1 the last reviewer — ${value}`];

    for (const json of [
      JSON.stringify({ description: { full: value } }, null, 2),
      JSON.stringify({ description: { full: value } }),
    ]) {
      expect(
        aliasReport(
          unanimityAliases({
            surfaces: [{ path: "m.json", field: "description.full" }],
            repo: fakeRepo({ "m.json": json }),
          })
        )
      ).toEqual(expected);
    }
  });

  it("allows the two phrases the documents quote verbatim", () => {
    // The allowance is load-bearing rather than decorative, and the
    // quotation marks ARE the allowance.
    //
    // The guide is required to quote the panel's copy unchanged, and the
    // pill reads "All reviewed" whether or not everyone on the reviewer
    // list looked. The README quotes the AIUP strategy PRSync exists to
    // serve — "wait for all reviewers, then act" is a description of how
    // the team works, not a claim about when a round closes.
    //
    // Both are exempt quoted and checked as prose, so the scanner stays
    // blunt about the sentence that would actually be wrong.
    for (const quoted of [
      'The pill reads "All reviewed".',
      'That makes "wait for all reviewers, then act" the correct strategy.',
    ]) {
      expect(
        aliasReport(
          unanimityAliases({
            surfaces: [{ path: "surface.md" }],
            repo: fakeRepo({ "surface.md": quoted }),
          })
        ),
        quoted
      ).toEqual([]);
    }

    for (const prose of [
      "The pill appears once all reviewers are done.",
      "PRSync waits for all reviewers, then acts.",
    ]) {
      expect(
        aliasReport(
          unanimityAliases({
            surfaces: [{ path: "surface.md" }],
            repo: fakeRepo({ "surface.md": prose }),
          })
        ),
        `the quotation allowance is swallowing a phrase it was meant to leave checked: ${prose}`
      ).not.toEqual([]);
    }
  });

  it("finds nothing to report where a surface yields no text", () => {
    // What a vacuously green scan looks like from the inside: rename
    // `description.full` and there is nothing to scan. `surfaceText`'s own
    // test pins that it answers `""` rather than throwing; this pins that
    // the scanner is quiet rather than wrong about it, which is what makes
    // the caller's has-something-to-scan floor the thing that catches it.
    const repo = fakeRepo({
      "m.json": JSON.stringify({ description: { summary: "quorum" } }),
      "broken.json": "{ not json",
    });

    for (const surface of [
      { path: "m.json", field: "description.full" },
      { path: "broken.json", field: "description" },
      { path: "absent.json", field: "description" },
    ]) {
      expect(
        aliasReport(unanimityAliases({ surfaces: [surface], repo })),
        surface.path
      ).toEqual([]);
    }
  });
});

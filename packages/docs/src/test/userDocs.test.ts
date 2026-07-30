import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { section } from "../lib";
import { readDocument, repoAt } from "../repo";
import { fakeRepo, nothingExists, recordingRepo } from "./fixtures/fakes";
import {
  SETTING_PATTERN,
  githubSlug,
  unresolvedLinks,
  unanimityAliases,
  surfaceText,
  type Surface,
  type UnanimityHit,
  type UnresolvedLink,
} from "./fixtures/markdown";

// The user-facing documentation ships no behaviour, so what rots is the
// agreement between a document written in plain language and the domain
// it describes. Two failures are worth a test:
//
//   1. the guide GLOSSES terms that `docs/ubiquitous-language.md`
//      DEFINES. A gloss that stops naming its canonical term verbatim
//      has quietly become a second, competing definition — which is the
//      exact failure the split exists to prevent, and this is the only
//      place it is catchable;
//   2. a round closes on QUORUM, not unanimity. "When everyone has
//      finished reviewing, the round closes" is not a loose paraphrase
//      of that rule, it is a description of a different product — and
//      that sentence has already shipped in this repo more than once.
//
// Both are asserted by reading two sources together, in the spirit of
// this package's `deploymentDocs.test.ts`.
//
// `docs/setup-guide.md` adds two more, and they are a different kind of
// check. It owns SEQUENCE — the order the stages happen in, and nothing
// else — so what rots is a stage going missing and the ownership rule
// leaking:
//
//   3. a stage silently deleted or reordered leaves a sequence that still
//      reads as a sequence. The order is the document's entire content,
//      and eleven stages that skip one are worse than none;
//   4. a setting NAME appearing in the setup guide is the no-duplication
//      rule breaking. Two documents that both describe configuration is
//      the state this split exists to leave behind, and the copy is
//      always the one that goes stale.
//
// With `README.md` restructured into the front door, a fifth failure
// becomes both possible and invisible:
//
//   5. the four documents now cross-reference each other instead of
//      repeating each other, which is the whole point — and a reader
//      clicks between them. Not duplicating is paid for in links, and a
//      link that resolves to nothing is a worse answer than the
//      duplication it replaced. Nothing about a broken `#anchor` looks
//      broken in the source; it renders as a link and lands at the top of
//      the page.
//
// And a sixth, which is the only one on this list that is not
// hypothetical — it is the state the repo shipped in:
//
//   6. the DERIVED SURFACES drift, because nothing reads them. The
//      README, the Marketplace description and the Teams manifest's
//      `description.full` each summarise the user guide, and each is
//      maintained by hand in a different file with a different reviewer.
//      The manifest's is the sentence every person installing the Teams
//      app reads, and it said the author hears back "when the last
//      reviewer marks themselves done" — a close rule PRSync does not
//      have, sitting in front of every teammate PRSync was built for.
//
// Which is why assertion 6 scans a JSON DESCRIPTION FIELD and not a
// document: two of the three surfaces are strings inside build manifests,
// and reading either file as raw text would both trip on the sibling
// fields it must ignore and break on a reformat that changed nothing.
//
// Assertion strength, recorded honestly:
//
//   - Assertion 1 (stage headings complete and ascending) is
//     STRUCTURAL. It proves twelve headings exist in ascending order and
//     nothing whatsoever about what is under them — a stage emptied to a
//     single word still passes. What it catches is a stage disappearing.
//   - Assertion 2 (no setting tokens outside a link) is STRUCTURAL too,
//     and narrower than the rule it serves: it catches a setting NAME,
//     which is the mechanically recognisable half. A value described in
//     prose without naming its setting passes, and only a human read
//     catches that.
//   - Assertion 3 (every relative link and `#anchor` resolves) is
//     STRONG. It is a mechanical fact about the filesystem and about the
//     headings the target documents actually carry: move a document,
//     rename a heading, or delete a section, and every link into it goes
//     red by name and line. What it does NOT claim is that a resolving
//     link points somewhere USEFUL — a link to the wrong real heading
//     passes, and only a human read catches that.
//   - Assertion 4 (glossed terms exist verbatim upstream) is STRONG. It
//     is a mechanical fact about two files: rename a term in the
//     ubiquitous language and this goes red.
//   - Assertion 5 (no unanimity alias in either guide) is STRONG, and
//     deliberately BLUNT. It matches words, not meaning, so it will
//     occasionally ask for a sentence to be rephrased that was not
//     actually wrong. That is the accepted cost of catching the one
//     paraphrase that is.
//   - Assertion 6 (no unanimity alias on a derived surface) is STRONG
//     about the same words over three more surfaces, and it inherits
//     assertion 5's bluntness exactly. What it adds is that two of the
//     surfaces are read as JSON VALUES, so it is indifferent to how the
//     manifests are formatted and blind to every field it was not
//     pointed at. What it does NOT claim is that a surface still
//     summarises the user guide FAITHFULLY — drop the summary and write
//     three accurate sentences of your own and it passes, because "adds
//     no claim the user guide does not make" is not a mechanical
//     property. The one mechanical half of it — that the Marketplace
//     description still carries the pointer at all — is asserted
//     separately, and is STRUCTURAL for the same reason assertion 2 is:
//     it proves the pointer exists and nothing about where it goes.
//
// None claims to check prose quality — nothing here can, which is why
// these documents get a human read-through before they merge.
//
// All six assertions of the plan (`docs/PRDs/04-user-docs-plan.md`) are
// now present.

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const userGuidePath = resolve(repoRoot, "docs/user-guide.md");
const setupGuidePath = resolve(repoRoot, "docs/setup-guide.md");
const languagePath = resolve(repoRoot, "docs/ubiquitous-language.md");

/** The one terminology section the user guide is allowed to carry. */
const GLOSS_HEADING = /^#+\s+Five words PRSync uses precisely\s*$/i;

/**
 * The two guides assertion 5 scans. The user guide is authoritative for
 * what PRSync does and the setup guide describes the close rule in
 * passing — a wrong sentence in either is the same wrong sentence.
 */
const GUIDES: readonly Surface[] = [
  { path: "docs/user-guide.md" },
  { path: "docs/setup-guide.md" },
];

/**
 * The Teams app's description, named on its own because it is the
 * sentence a teammate reads at the moment they install PRSync, and
 * because it is the one that shipped wrong.
 */
const TEAMS_DESCRIPTION: Surface = {
  path: "packages/bot/teams/manifest.json",
  field: "description.full",
};

/** The Marketplace listing's description. */
const MARKETPLACE_DESCRIPTION: Surface = {
  path: "packages/extension/vss-extension.json",
  field: "description",
};

/**
 * The three derived surfaces assertion 6 scans: every user-facing
 * description that is not the user guide. Each may summarise it; none may
 * add a claim of its own, and all three are edited in files whose
 * reviewer is thinking about packaging rather than about the close rule.
 */
const DERIVED_SURFACES: readonly Surface[] = [
  { path: "README.md" },
  TEAMS_DESCRIPTION,
  MARKETPLACE_DESCRIPTION,
];

/**
 * What assertions 5 and 6 must never read, from the exclusion the plan
 * calls load-bearing.
 *
 * Every one of these names the superseded rule ON PURPOSE — design logs
 * are immutable snapshots of what was believed at the time, and the
 * ubiquitous language's aliases-to-avoid columns and its "Unanimity
 * language is drift" entry exist precisely to write the wrong words down
 * so they are recognisable. A scanner pointed at them fails on day one,
 * for the right words in the right places, and the only available fix
 * would be to delete the record.
 *
 * Note that assertion 4 reads `docs/ubiquitous-language.md` and must:
 * this exclusion is scoped to the alias scan, not to the file.
 */
const NEVER_SCANNED: readonly string[] = [
  "docs/design-logs/",
  "docs/PRDs/",
  "docs/refactor-plans/",
  "docs/dev-journal.md",
  "docs/ubiquitous-language.md",
];

/** Alias hits as one line each, so a failure reads like a linter. */
function aliasReport(hits: readonly UnanimityHit[]): string[] {
  return hits.map(
    ({ surface, line, alias, text }) => `${surface}:${line} ${alias} — ${text}`
  );
}

/**
 * Every `**bolded**` span in `markdown`, in order, without duplicates.
 *
 * A span is read across line breaks and its whitespace collapsed, because
 * a two-word term wrapped by the formatter (`**Round\nclosed**`) renders
 * as one bolded term and must be checked as one. Matching line-by-line
 * instead pairs the wrapped term's closing `**` with the NEXT term's
 * opening one, and reports the prose between them as an unknown term.
 */
function boldedTerms(markdown: string): string[] {
  const found = markdown.match(/\*\*[^*]+\*\*/g) ?? [];
  return [
    ...new Set(
      found.map((term) => term.slice(2, -2).replace(/\s+/g, " ").trim())
    ),
  ];
}

/** A stage heading in `docs/setup-guide.md`, capturing its number. */
const STAGE_HEADING = /^#+\s+Stage\s+(\d+)\b/;

/**
 * The last stage the setup guide carries. Pinned rather than derived from
 * the document, because a count read out of the document it is checking
 * would agree with itself: deleting the final stage would move the
 * expected count down with it. Eleven stages plus stage 0 is the
 * documented contract — the stage table in `docs/PRDs/04-user-docs-plan.md`
 * and `docs/design-logs/04-user-docs.md`. Adding a twelfth is a decision,
 * and a decision should have to touch this line.
 */
const LAST_STAGE = 11;

interface TokenHit {
  token: string;
  line: number;
  text: string;
}

/** The stage numbers `markdown` declares, in the order they appear. */
function stageNumbers(markdown: string): number[] {
  return markdown
    .split("\n")
    .map((line) => line.match(STAGE_HEADING)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number);
}

/**
 * `line` with every markdown link removed — both the text and the
 * destination.
 *
 * The setup guide is allowed to POINT at a setting; it is not allowed to
 * name one as prose. A link is what a pointer looks like, so stripping
 * links first is what distinguishes "read the bot settings [here]" from a
 * second copy of the settings table.
 */
function withoutLinks(line: string): string {
  return line
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ") // [text](destination)
    .replace(/<[^>\s]+>/g, " "); // <https://autolink>
}

/**
 * Every PRSync setting token in `markdown` that is not inside a link.
 *
 * Code spans are deliberately NOT exempt: a backticked setting name is
 * the exact shape the duplicated configuration table would take.
 */
function settingTokens(markdown: string): TokenHit[] {
  const hits: TokenHit[] = [];

  markdown.split("\n").forEach((raw, index) => {
    for (const token of withoutLinks(raw).match(SETTING_PATTERN) ?? []) {
      hits.push({ token, line: index + 1, text: raw.trim() });
    }
  });

  return hits;
}

describe("the setup guide's stages", () => {
  it("carries every numbered stage, in ascending order", () => {
    // Assertion 1, structural. The guide owns sequence and nothing else,
    // so a missing or reordered stage is not a formatting problem — it is
    // the document's content being wrong. This proves the headings and
    // says nothing at all about what is under them.
    const guide = readDocument(setupGuidePath, "docs/setup-guide.md");
    const stages = stageNumbers(guide);

    const expected = Array.from({ length: LAST_STAGE + 1 }, (_, i) => i);

    expect(
      stages,
      `docs/setup-guide.md declares stages ${stages.join(", ")}; it is contracted to carry 0 through ${LAST_STAGE}, once each, in order`
    ).toEqual(expected);
  });
});

describe("the setup guide's ownership", () => {
  it("names no setting outside a link", () => {
    // Assertion 2, structural. `docs/deployment.md` owns setting values;
    // this guide owns order. A setting named here is a second copy of a
    // table that already exists, and the copy is the one that goes stale
    // — which is the whole reason the two documents were split.
    const guide = readDocument(setupGuidePath, "docs/setup-guide.md");
    const hits = settingTokens(guide);

    expect(
      hits.map(({ token, line, text }) => `${token} — line ${line}: ${text}`),
      "docs/setup-guide.md names settings docs/deployment.md owns; it should link to them instead"
    ).toEqual([]);
  });

  it("allows a setting to be pointed at by a link", () => {
    // The allowance is what makes the rule followable rather than a ban
    // on ever mentioning configuration: the guide has to send the reader
    // somewhere. Linked it passes; written as prose or as a code span it
    // is the duplication.
    expect(
      settingTokens(
        "Then set [`MICROSOFT_APP_ID`](deployment.md#prerequisite-bot-configuration)."
      )
    ).toEqual([]);

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
});

describe("the user guide's gloss section", () => {
  it("names only terms the ubiquitous language defines verbatim", () => {
    // Assertion 4, strong. The guide glosses; `ubiquitous-language.md`
    // defines. A gloss whose term no longer exists upstream is either
    // glossing a renamed concept or has invented one of its own, and a
    // reader has no way to tell those apart from the prose.
    const guide = readDocument(userGuidePath, "docs/user-guide.md");
    const language = readDocument(languagePath, "docs/ubiquitous-language.md");

    const gloss = section(guide, GLOSS_HEADING);
    expect(
      gloss,
      "docs/user-guide.md has no gloss section, so its terminology is unanchored"
    ).toBeTruthy();

    const terms = boldedTerms(gloss as string);

    // A floor, not a checklist: the section is named for five words, so
    // an extractor that silently finds nothing must not pass.
    expect(
      terms.length,
      "the gloss section bolds fewer than five terms"
    ).toBeGreaterThanOrEqual(5);

    // Bolded upstream too, not merely present: the ubiquitous language
    // marks its canonical terms in bold, and matching bare text would
    // pass on a word that happens to appear in a definition's prose.
    const unanchored = terms.filter(
      (term) => !language.includes(`**${term}**`)
    );

    expect(
      unanchored,
      `docs/user-guide.md glosses terms that docs/ubiquitous-language.md does not define verbatim:\n  ${unanchored.join("\n  ")}`
    ).toEqual([]);
  });
});

/** A manifest carrying `description.short` and `description.full`. */
function manifestWith(description: {
  short: string;
  full: string;
}): Record<string, string> {
  return {
    "teams/manifest.json": JSON.stringify({ description }, null, 2),
  };
}

describe("the unanimity scanner", () => {
  it("reads a JSON field's value, and only the field it was given", () => {
    // The whole reason assertion 6 reads JSON as JSON. `description.short`
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
    // The property that makes assertion 6 safe to leave in the suite: the
    // manifests are formatted by Prettier and their indentation is not a
    // decision anyone makes. A check against raw text moves its line
    // numbers on a reformat and eventually gets deleted for crying wolf.
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

  it("finds no text where a JSON field has been renamed or the file is not JSON", () => {
    // What a vacuously green assertion 6 looks like from the inside:
    // rename `description.full` and the scan has nothing to scan. It
    // returns no text rather than throwing, because the floor below
    // reports "this surface is empty" by name, which is a better failure
    // than a parse trace from somewhere inside the scanner.
    const repo = fakeRepo({
      "m.json": JSON.stringify({ description: { summary: "quorum" } }),
      "broken.json": "{ not json",
      "nested.json": JSON.stringify({ description: { full: { en: "hi" } } }),
    });

    for (const surface of [
      { path: "m.json", field: "description.full" },
      { path: "broken.json", field: "description" },
      // A field that resolves to an object, not a string: there is no
      // sentence there to check.
      { path: "nested.json", field: "description.full" },
      { path: "absent.json", field: "description" },
    ]) {
      expect(surfaceText(surface, repo), surface.path).toBe("");
      expect(
        aliasReport(unanimityAliases({ surfaces: [surface], repo }))
      ).toEqual([]);
    }
  });

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
});

describe("the guides' close rule", () => {
  it("never describes closing in unanimity language", () => {
    // Assertion 5, strong and blunt. A round closes on quorum. Every
    // word here describes a close rule PRSync does not have, and the
    // natural, friendly sentence is the one that gets it wrong.
    //
    // Both guides, not just the user guide: the setup guide describes the
    // close rule in passing when it explains what the operator should see
    // working, and a wrong sentence there is the same wrong sentence.
    const hits = unanimityAliases({
      surfaces: GUIDES,
      repo: repoAt(repoRoot),
    });

    expect(
      aliasReport(hits),
      `these sentences describe closing in unanimity language; a round closes on quorum:\n  ${aliasReport(hits).join("\n  ")}`
    ).toEqual([]);
  });
});

describe("the derived surfaces' close rule", () => {
  it("never describes closing in unanimity language", () => {
    // Assertion 6, strong. The user guide is authoritative and these
    // three summarise it, which means each is free to drift and none is
    // read by anyone whose job is the domain. The Teams manifest's
    // description is where it drifted, and it is the one surface a
    // teammate cannot avoid reading.
    const hits = unanimityAliases({
      surfaces: DERIVED_SURFACES,
      repo: repoAt(repoRoot),
    });

    expect(
      aliasReport(hits),
      `these derived surfaces describe closing in unanimity language; a round closes on quorum:\n  ${aliasReport(hits).join("\n  ")}`
    ).toEqual([]);
  });

  it("has something to scan on every surface", () => {
    // A floor, and the one that matters most here: `toEqual([])` is also
    // what a renamed field, a moved manifest or a re-pathed README
    // produces. Assertion 6 passing means nothing unless each of the five
    // surfaces it and assertion 5 read actually yielded a sentence.
    const repo = repoAt(repoRoot);

    for (const surface of [...GUIDES, ...DERIVED_SURFACES]) {
      const label = surface.field
        ? `${surface.path}#${surface.field}`
        : surface.path;

      expect(
        surfaceText(surface, repo).trim().length,
        `${label} yielded no text, so scanning it proves nothing`
      ).toBeGreaterThan(0);
    }
  });

  it("points the Marketplace listing at the user guide", () => {
    // Structural, and narrower than the rule it serves. The listing is a
    // summary plus a pointer; that it adds no claim the user guide does
    // not make needs a human read, but a pointer that has been dropped
    // is mechanically visible — and a Marketplace description that
    // explains PRSync on its own authority is how the next contradiction
    // gets written.
    const text = surfaceText(MARKETPLACE_DESCRIPTION, repoAt(repoRoot));

    expect(
      text,
      "packages/extension/vss-extension.json's description no longer points at docs/user-guide.md, so it is explaining PRSync on its own authority"
    ).toContain("docs/user-guide.md");
  });
});

describe("the alias scan's exclusions", () => {
  it("reads the five surfaces and nothing else", () => {
    // The exclusion asserted rather than merely arranged. A recording
    // `Repo` is the only place "never reads" is a fact instead of an
    // arrangement that happens to hold today — point either scan at a
    // directory of documents and this goes red by path.
    const { repo: recording, touched } = recordingRepo(repoAt(repoRoot));

    unanimityAliases({ surfaces: GUIDES, repo: recording });
    unanimityAliases({ surfaces: DERIVED_SURFACES, repo: recording });

    const forbidden = touched.filter((path) =>
      NEVER_SCANNED.some((excluded) => path.startsWith(excluded))
    );

    expect(
      forbidden,
      `assertions 5 and 6 read the paper trail, which names the superseded rule on purpose:\n  ${forbidden.join("\n  ")}`
    ).toEqual([]);

    // And positively, so the exclusion above cannot be satisfied by a
    // scan that reads nothing at all.
    expect(new Set(touched)).toEqual(
      new Set([...GUIDES, ...DERIVED_SURFACES].map(({ path }) => path))
    );
  });

  it("would report on the paper trail, which is why it is pointed away from it", () => {
    // The exclusion is load-bearing, not tidiness. `docs/ubiquitous-
    // language.md` writes the wrong words down deliberately — its
    // aliases-to-avoid columns and its "Unanimity language is drift"
    // entry exist to make them recognisable — so a scan that reached it
    // would fail on day one, for the right words in the right places,
    // and the only available fix would be to delete the record.
    const hits = unanimityAliases({
      surfaces: [{ path: "docs/ubiquitous-language.md" }],
      repo: repoAt(repoRoot),
    });

    expect(
      hits.length,
      "docs/ubiquitous-language.md no longer names the superseded close rule, so the exclusion is protecting nothing"
    ).toBeGreaterThan(0);
  });
});

/**
 * The documents assertion 3 reads. Repo-relative, because that is what a
 * `Repo` is keyed by — the resolver never sees an absolute path, so a
 * failure names a file the way the reader's editor does.
 *
 * Adding a fourth document is one more entry here and no other change
 * anywhere. That is the resolver's interface property rather than a
 * convention, and the last test in "the link resolver" drives it.
 */
const CROSS_REFERENCED = [
  "README.md",
  "docs/setup-guide.md",
  "docs/user-guide.md",
] as const;

/** Unresolved links as one line each, so a failure reads like a linter. */
function report(hits: readonly UnresolvedLink[]): string[] {
  return hits.map(
    ({ document, line, target, reason }) =>
      `${document}:${line} ${target} — ${reason}`
  );
}

describe("GitHub heading slugs", () => {
  it("lowercases a heading and hyphenates its spaces", () => {
    expect(githubSlug("Deploying the bot")).toBe("deploying-the-bot");
    expect(githubSlug("Verifying a deploy")).toBe("verifying-a-deploy");
  });

  it("strips the punctuation GitHub strips rather than hyphenating it", () => {
    // Every left-hand side is a heading `docs/deployment.md` carries and
    // every right-hand side is an anchor `docs/setup-guide.md` links to.
    // A naive lowercase-and-hyphen pass turns the backticks and the slash
    // into hyphens and yields `why--api-messages--is-anonymous...`, which
    // resolves against nothing while LOOKING like a correct slug — which
    // is why the slugifier is worth a direct test rather than being left
    // to assertion 3 to imply.
    for (const [heading, slug] of [
      ["Prerequisite: bot configuration", "prerequisite-bot-configuration"],
      [
        "Prerequisite: the tables and the queue must already exist",
        "prerequisite-the-tables-and-the-queue-must-already-exist",
      ],
      [
        "Prerequisite: Function App CORS must allow the ADO org origin",
        "prerequisite-function-app-cors-must-allow-the-ado-org-origin",
      ],
      [
        "Why `/api/messages` is anonymous, and why that is not an open endpoint",
        "why-apimessages-is-anonymous-and-why-that-is-not-an-open-endpoint",
      ],
      [
        "Packaging and sideloading the Teams app",
        "packaging-and-sideloading-the-teams-app",
      ],
    ] as const) {
      expect(githubSlug(heading), heading).toBe(slug);
    }
  });

  it("leaves the gap an em-dash vacated, as two hyphens", () => {
    // The one rule that looks like a bug and is not. GitHub drops the
    // em-dash and then hyphenates both surviving spaces, so every heading
    // in this repo's house style slugs with a DOUBLE hyphen. An
    // implementation that tidies runs of hyphens away is wrong for every
    // stage heading in the setup guide at once.
    expect(
      githubSlug("Stage 4 — Messaging endpoint and the Teams channel")
    ).toBe("stage-4--messaging-endpoint-and-the-teams-channel");
    expect(githubSlug("Stage 1 — Storage: three tables and one queue")).toBe(
      "stage-1--storage-three-tables-and-one-queue"
    );
    expect(githubSlug("PRSync — Setup guide")).toBe("prsync--setup-guide");
  });
});

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
    // it was written in. A fourth guide is one more string in
    // CROSS_REFERENCED.
    const repo = fakeRepo({
      "README.md": "[gone](docs/nowhere.md)",
      "docs/setup-guide.md": "[gone](nowhere.md)",
      "docs/user-guide.md": "[gone](../nowhere.md)",
    });

    expect(report(unresolvedLinks({ documents: ["README.md"], repo }))).toEqual(
      ["README.md:1 docs/nowhere.md — no such file"]
    );

    expect(
      report(unresolvedLinks({ documents: [...CROSS_REFERENCED], repo }))
    ).toEqual([
      "README.md:1 docs/nowhere.md — no such file",
      "docs/setup-guide.md:1 nowhere.md — no such file",
      "docs/user-guide.md:1 ../nowhere.md — no such file",
    ]);
  });
});

describe("the documents' cross-references", () => {
  it("resolves every relative link and anchor", () => {
    // Assertion 3, STRONG — see the file header for what it does and
    // does not claim. This is what makes cross-referencing cheaper than
    // duplicating: the README routes three readers, the setup guide sends
    // every value and every failure to `docs/deployment.md`, and the user
    // guide ends at `docs/ubiquitous-language.md`. None of that is safe
    // unless the clicks land.
    const hits = unresolvedLinks({
      documents: [...CROSS_REFERENCED],
      repo: repoAt(repoRoot),
    });

    expect(
      report(hits),
      `these links resolve to nothing:\n  ${report(hits).join("\n  ")}`
    ).toEqual([]);
  });

  it("finds a link in every document it is pointed at", () => {
    // A floor. `toEqual([])` is exactly what an extractor that finds no
    // links at all produces, and these three documents carry dozens of
    // cross-references between them. Pointed at their real text with a
    // repo where nothing exists, every one of them must report.
    //
    // It also pins which side of the port each path goes through: the
    // documents in the set are READ, never existence-checked — the caller
    // pins those three paths, and a missing one is `readDocument`'s failure to
    // report, not a link to nowhere.
    const documents = report(
      unresolvedLinks({
        documents: [...CROSS_REFERENCED],
        repo: nothingExists(repoAt(repoRoot)),
      })
    ).map((line) => line.split(":")[0]);

    expect(
      new Set(documents),
      "a document contributed no unresolvable link even though nothing exists, so its links are not being read"
    ).toEqual(new Set(CROSS_REFERENCED));
  });
});

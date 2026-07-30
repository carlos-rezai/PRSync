import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTING_PATTERN, readDoc, section } from "./fixtures/markdown";

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
//   - Assertion 4 (glossed terms exist verbatim upstream) is STRONG. It
//     is a mechanical fact about two files: rename a term in the
//     ubiquitous language and this goes red.
//   - Assertion 5 (no unanimity alias) is STRONG, and deliberately
//     BLUNT. It matches words, not meaning, so it will occasionally ask
//     for a sentence to be rephrased that was not actually wrong. That
//     is the accepted cost of catching the one paraphrase that is.
//
// None claims to check prose quality — nothing here can, which is why
// these documents get a human read-through before they merge.
//
// The remaining two assertions of the plan
// (`docs/PRDs/04-user-docs-plan.md`) land with the documents they
// describe: 3 once all three documents exist, 6 with the derived
// surfaces. Assertion 5's scan is pointed at the user guide only; the
// plan scopes it to both guides, and the setup guide joins it with the
// scanner change that assertion 6 makes.

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const userGuidePath = resolve(repoRoot, "docs/user-guide.md");
const setupGuidePath = resolve(repoRoot, "docs/setup-guide.md");
const languagePath = resolve(repoRoot, "docs/ubiquitous-language.md");

/** The one terminology section the user guide is allowed to carry. */
const GLOSS_HEADING = /^#+\s+Five words PRSync uses precisely\s*$/i;

/**
 * The words that describe a close rule PRSync does not have, from the
 * "Unanimity language is drift, not phrasing" entry in
 * `docs/ubiquitous-language.md`. Each is labelled by the alias it stands
 * for so a failure names the rule that was broken, not just the regex.
 *
 * `all reviewed` is matched alongside `all reviewers` on purpose: it is
 * the panel's own pill text, and quoting the pill is legitimate while
 * writing the same phrase as prose is the drift. The quoted form is what
 * `ALLOWED_QUOTATIONS` exempts, so the distinction is carried by the
 * quotation marks rather than by leaving the phrase unchecked.
 */
const UNANIMITY_ALIASES: ReadonlyArray<readonly [string, RegExp]> = [
  ["unanimous", /\bunanimous(ly)?\b|\bunanimity\b/i],
  ["consensus", /\bconsensus\b/i],
  ["everyone", /\beveryone\b/i],
  ["all reviewers", /\ball\s+review(ers?|ed)\b/i],
  ["signed off", /\bsign(s|ed)?\s+off\b|\bsign-?off\b/i],
  ["approved", /\bapproved\b/i],
];

/**
 * UI strings the guide may quote verbatim even though they trip an alias.
 * The quotation marks are part of the allowance: "All reviewed" is what
 * the status pill renders, and a reader matching words on screen to words
 * on the page needs it unchanged — but the same phrase written as prose
 * is the drift this file exists to catch.
 */
const ALLOWED_QUOTATIONS = ['"All reviewed"'];

interface AliasHit {
  alias: string;
  line: number;
  text: string;
}

/**
 * Every line of `markdown` that describes closing in unanimity language,
 * with the allowed verbatim quotations removed first.
 *
 * Takes text rather than a path so the same scan can be pointed at a JSON
 * description field, which is where the contradiction has actually
 * shipped before.
 */
function unanimityAliases(markdown: string): AliasHit[] {
  const hits: AliasHit[] = [];

  markdown.split("\n").forEach((raw, index) => {
    const line = ALLOWED_QUOTATIONS.reduce(
      (text, quotation) => text.split(quotation).join(" "),
      raw
    );

    for (const [alias, pattern] of UNANIMITY_ALIASES) {
      if (pattern.test(line)) {
        hits.push({ alias, line: index + 1, text: raw.trim() });
      }
    }
  });

  return hits;
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
    const guide = readDoc(setupGuidePath, "docs/setup-guide.md");
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
    const guide = readDoc(setupGuidePath, "docs/setup-guide.md");
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
    const guide = readDoc(userGuidePath, "docs/user-guide.md");
    const language = readDoc(languagePath, "docs/ubiquitous-language.md");

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

describe("the user guide's close rule", () => {
  it("never describes closing in unanimity language", () => {
    // Assertion 5, strong and blunt. A round closes on quorum. Every
    // word here describes a close rule PRSync does not have, and the
    // natural, friendly sentence is the one that gets it wrong.
    const guide = readDoc(userGuidePath, "docs/user-guide.md");
    const hits = unanimityAliases(guide);

    expect(
      hits.map(({ alias, line, text }) => `${alias} — line ${line}: ${text}`),
      "docs/user-guide.md describes closing in unanimity language; a round closes on quorum"
    ).toEqual([]);
  });

  it("allows the status pill to be quoted verbatim", () => {
    // The allowance is load-bearing rather than decorative: the guide is
    // required to quote the panel's copy unchanged, and the pill reads
    // "All reviewed" whether or not a person on the reviewer list ever
    // looked. Quoted it passes; as prose it is drift.
    expect(unanimityAliases('The pill reads "All reviewed".')).toEqual([]);

    expect(
      unanimityAliases("The pill appears once all reviewers are done."),
      "the quoted-pill allowance is swallowing the phrase it was meant to leave checked"
    ).not.toEqual([]);
  });
});

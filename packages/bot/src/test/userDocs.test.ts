import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDoc, section } from "./fixtures/markdown";

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
// Assertion strength, recorded honestly:
//
//   - Assertion 4 (glossed terms exist verbatim upstream) is STRONG. It
//     is a mechanical fact about two files: rename a term in the
//     ubiquitous language and this goes red.
//   - Assertion 5 (no unanimity alias) is STRONG, and deliberately
//     BLUNT. It matches words, not meaning, so it will occasionally ask
//     for a sentence to be rephrased that was not actually wrong. That
//     is the accepted cost of catching the one paraphrase that is.
//
// Neither claims to check prose quality — nothing here can, which is why
// this document gets a human read-through before it merges.
//
// The remaining four assertions of the plan
// (`docs/PRDs/04-user-docs-plan.md`) land with the documents they
// describe: 1 and 2 with `docs/setup-guide.md`, 3 once all three
// documents exist, 6 with the derived surfaces.

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const userGuidePath = resolve(repoRoot, "docs/user-guide.md");
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

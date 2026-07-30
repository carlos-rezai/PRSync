import { describe, it, expect } from "vitest";
import { boldedTerms, section } from "../lib";
import { readDocument } from "../repo";
import {
  at,
  GLOSS_HEADING,
  UBIQUITOUS_LANGUAGE,
  USER_GUIDE,
} from "./documents";

// The user guide GLOSSES terms that `docs/ubiquitous-language.md`
// DEFINES. A gloss that stops naming its canonical term verbatim has
// quietly become a second, competing definition — which is the exact
// failure the split between those two documents exists to prevent, and
// this is the only place it is catchable.
//
// The assertion is STRONG: it is a mechanical fact about two files.
// Rename a term in the ubiquitous language and this goes red by name.
//
// What it does not claim is that the gloss is a GOOD one. Nothing here
// checks prose quality — which is why these documents get a human
// read-through before they merge.

describe("the user guide's gloss section", () => {
  it("names only terms the ubiquitous language defines verbatim", () => {
    // A gloss whose term no longer exists upstream is either glossing a
    // renamed concept or has invented one of its own, and a reader has no
    // way to tell those apart from the prose.
    const guide = readDocument(at(USER_GUIDE), USER_GUIDE);
    const language = readDocument(at(UBIQUITOUS_LANGUAGE), UBIQUITOUS_LANGUAGE);

    const gloss = section(guide, GLOSS_HEADING);
    expect(
      gloss,
      `${USER_GUIDE} has no gloss section, so its terminology is unanchored`
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
      `${USER_GUIDE} glosses terms that ${UBIQUITOUS_LANGUAGE} does not define verbatim:\n  ${unanchored.join("\n  ")}`
    ).toEqual([]);
  });
});

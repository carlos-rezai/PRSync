// The markdown reads the documentation tests share.
//
// Two tests in this package assert the agreement between a document and
// the source it makes claims about: `deploymentDocs.test.ts` (every
// setting the code reads is documented, under the package that reads it)
// and `userDocs.test.ts` (the guides and the ubiquitous language do not
// drift). Both need the same three things — open a document and fail
// loudly if it is missing, isolate one section of it, and recognise a
// PRSync setting token — and the first of them had all three private.
//
// It lives here rather than in either test for the same reason
// `sourceFiles.ts` does: it is a cross-layer test helper, which is
// exactly what `src/test/fixtures/` holds, and the same reason `fakes.ts`
// and `fixtures.ts` sit outside the layer conventions.
//
// The link resolver at the bottom joins them for the same reason: the four
// user-facing documents cross-reference each other instead of repeating
// each other, and a link that resolves to nothing is a worse answer than
// the duplication it replaced.
//
// The unanimity scanner joins them last, and it is the one reader here that
// is not looking at markdown alone. Three DERIVED SURFACES summarise the
// user guide — the README, the Marketplace listing's `description` and the
// Teams manifest's `description.full` — and two of the three are strings
// inside build manifests. So a surface is a path plus an optional JSON
// field, and the check is against the field's VALUE rather than the file's
// raw text: reformatting a manifest cannot break it, and a sibling field it
// was not pointed at cannot trip it.

import { surfaceText, surfaceLabel, type Surface } from "../../checks";
import type { Repo } from "../../repo";

/** One sentence describing a close rule PRSync does not have. */
export interface UnanimityHit {
  /** The surface it is written on: `path`, or `path#field` for a JSON one. */
  surface: string;
  /** The 1-based line within the surface's text. */
  line: number;
  /** The alias that matched, named as `docs/ubiquitous-language.md` lists it. */
  alias: string;
  /** The line as written, trimmed, so the failure reads like a linter. */
  text: string;
}

/** What to scan: the surfaces, and the filesystem to read them from. */
export interface SurfaceScan {
  /**
   * The surfaces to read. Data rather than parameters for the same reason
   * `LinkCheck.documents` is: a fourth derived surface changes no signature.
   */
  surfaces: readonly Surface[];
  repo: Repo;
}

/** A phrase that describes a close rule PRSync does not have. */
interface Alias {
  /** What a failure names — the phrase as the ubiquitous language lists it. */
  label: string;
  pattern: RegExp;
}

/**
 * The unanimity vocabulary, from the ubiquitous language's "Unanimity
 * language is drift, not phrasing" entry.
 *
 * A round closes on **Quorum**. Every phrase here describes closing on
 * unanimity instead, and each is the natural, friendly way to write the
 * sentence — which is exactly why the list is pinned rather than trusted to
 * one regex.
 *
 * Note the absent `g` flag: `.test()` on a shared global regex resumes from
 * wherever the previous line left off, so half the lines would go unscanned.
 */
const UNANIMITY_ALIASES: readonly Alias[] = [
  { label: "everyone", pattern: /everyone/i },
  { label: "consensus", pattern: /consensus/i },
  { label: "unanimous", pattern: /unanimous|unanimity/i },
  { label: "all reviewers", pattern: /all\s+reviewe(?:rs?|d)/i },
  { label: "signed off", pattern: /signed[\s-]off/i },
  { label: "approved", pattern: /approved/i },
  { label: "the last reviewer", pattern: /last\s+reviewer/i },
];

/**
 * `line` with every double-quoted span removed.
 *
 * The quotation marks ARE the allowance, and it is load-bearing rather than
 * decorative: the user guide is required to quote the panel's copy
 * unchanged, and the pill reads "All reviewed" whether or not everyone on
 * the reviewer list looked. The README quotes the AIUP strategy PRSync
 * exists to serve — "wait for all reviewers, then act" describes how the
 * team works, not when a round closes.
 *
 * Written as prose, both are checked, which is what keeps the scan blunt
 * about the sentence that would actually be wrong.
 */
function withoutQuotations(line: string): string {
  return line.replace(/"[^"]*"/g, " ");
}

/**
 * Every sentence on `surfaces` that describes closing in unanimity
 * language.
 *
 * Deliberately BLUNT: it matches words, not meaning, so it will
 * occasionally ask for a sentence to be rephrased that was not actually
 * wrong. That is the accepted cost of catching the one paraphrase that is —
 * and that paraphrase has shipped in this repo more than once.
 */
export function unanimityAliases({
  surfaces,
  repo,
}: SurfaceScan): UnanimityHit[] {
  const hits: UnanimityHit[] = [];

  for (const surface of surfaces) {
    const label = surfaceLabel(surface);

    surfaceText(surface, repo)
      .split("\n")
      .forEach((raw, index) => {
        const prose = withoutQuotations(raw);

        for (const { label: alias, pattern } of UNANIMITY_ALIASES) {
          if (pattern.test(prose)) {
            hits.push({
              surface: label,
              line: index + 1,
              alias,
              text: raw.trim(),
            });
          }
        }
      });
  }

  return hits;
}

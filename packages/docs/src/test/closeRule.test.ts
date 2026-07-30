import { describe, it, expect } from "vitest";
import {
  surfaceLabel,
  surfaceText,
  unanimityAliases,
  type UnanimityHit,
} from "../checks";
import { repoAt } from "../repo";
import { recordingRepo } from "./fixtures/fakes";
import {
  DERIVED_SURFACES,
  GUIDES,
  MARKETPLACE_DESCRIPTION,
  NEVER_SCANNED,
  repoRoot,
  UBIQUITOUS_LANGUAGE,
} from "./documents";

// One rule, read over five surfaces: A ROUND CLOSES ON QUORUM.
//
// "When everyone has finished reviewing, the round closes" is not a loose
// paraphrase of that rule, it is a description of a different product —
// and that sentence has already shipped in this repo more than once. The
// two guides and the three derived surfaces are asserted together here
// because splitting them by file would split one rule across two specs.
//
// The derived surfaces are the half that is not hypothetical. The README,
// the Marketplace description and the Teams manifest's `description.full`
// each summarise the user guide, each is maintained by hand in a different
// file with a different reviewer, and nothing read them. The manifest's is
// the sentence every person installing the Teams app sees, and it said the
// author hears back "when the last reviewer marks themselves done" — a
// close rule PRSync does not have, sitting in front of every teammate
// PRSync was built for.
//
// Assertion strength, recorded honestly. The scan is STRONG and
// deliberately BLUNT: it matches words, not meaning, so it will
// occasionally ask for a sentence to be rephrased that was not actually
// wrong. That is the accepted cost of catching the one paraphrase that is.
//
// What it does NOT claim is that a surface still summarises the user guide
// FAITHFULLY — drop the summary and write three accurate sentences of your
// own and it passes, because "adds no claim the user guide does not make"
// is not a mechanical property. The one mechanical half of it, that the
// Marketplace description still carries the pointer at all, is asserted
// separately below and is STRUCTURAL: it proves the pointer exists and
// nothing about where it goes.

/** Alias hits as one line each, so a failure reads like a linter. */
function aliasReport(hits: readonly UnanimityHit[]): string[] {
  return hits.map(
    ({ surface, line, alias, text }) => `${surface}:${line} ${alias} — ${text}`
  );
}

describe("the guides' close rule", () => {
  it("never describes closing in unanimity language", () => {
    // Both guides, not just the user guide: the setup guide describes the
    // close rule in passing when it explains what the operator should see
    // working, and a wrong sentence there is the same wrong sentence.
    const hits = unanimityAliases({ surfaces: GUIDES, repo: repoAt(repoRoot) });

    expect(
      aliasReport(hits),
      `these sentences describe closing in unanimity language; a round closes on quorum:\n  ${aliasReport(hits).join("\n  ")}`
    ).toEqual([]);
  });
});

describe("the derived surfaces' close rule", () => {
  it("never describes closing in unanimity language", () => {
    // The user guide is authoritative and these three summarise it, which
    // means each is free to drift and none is read by anyone whose job is
    // the domain.
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
    // produces. The scan passing means nothing unless each of the five
    // surfaces actually yielded a sentence.
    const repo = repoAt(repoRoot);

    for (const surface of [...GUIDES, ...DERIVED_SURFACES]) {
      expect(
        surfaceText(surface, repo).trim().length,
        `${surfaceLabel(surface)} yielded no text, so scanning it proves nothing`
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
      `${MARKETPLACE_DESCRIPTION.path}'s description no longer points at docs/user-guide.md, so it is explaining PRSync on its own authority`
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
      `the close-rule scan read the paper trail, which names the superseded rule on purpose:\n  ${forbidden.join("\n  ")}`
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
      surfaces: [{ path: UBIQUITOUS_LANGUAGE }],
      repo: repoAt(repoRoot),
    });

    expect(
      hits.length,
      `${UBIQUITOUS_LANGUAGE} no longer names the superseded close rule, so the exclusion is protecting nothing`
    ).toBeGreaterThan(0);
  });
});

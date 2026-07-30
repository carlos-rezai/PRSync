import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  surfaceLabel,
  surfaceText,
  unanimityAliases,
  unresolvedLinks,
  type Surface,
  type UnanimityHit,
  type UnresolvedLink,
} from "../checks";
import { boldedTerms, section, settingTokens, stageNumbers } from "../lib";
import { readDocument, repoAt } from "../repo";
import { nothingExists, recordingRepo } from "./fixtures/fakes";

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
 * The last stage the setup guide carries. Pinned rather than derived from
 * the document, because a count read out of the document it is checking
 * would agree with itself: deleting the final stage would move the
 * expected count down with it. Eleven stages plus stage 0 is the
 * documented contract — the stage table in `docs/PRDs/04-user-docs-plan.md`
 * and `docs/design-logs/04-user-docs.md`. Adding a twelfth is a decision,
 * and a decision should have to touch this line.
 */
const LAST_STAGE = 11;

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

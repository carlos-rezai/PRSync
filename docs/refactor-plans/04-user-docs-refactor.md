# 04 — User Docs Refactor

Refactor plan for Feature 4 (`user-docs`, issues #26–#31), written
2026-07-30 against the feature-complete state: `packages/bot` at 153
tests across 23 files, `packages/api` at 180, `packages/extension` at
191, all green under `lint`, `typecheck` and `test`.

Scope is the documentation and the tests that read it. No product code
changes: nothing under `packages/api/src`, `packages/extension/src`, or
`packages/bot/src` outside `src/test/` is touched, and no card, contract,
setting or behaviour changes.

## Problem Statement

Feature 4 shipped four documents and one very large test, and both halves
ended up in the wrong place.

**The repo's documentation tests live inside the Teams bot.**
`packages/bot/src/test/userDocs.test.ts` asserts against `README.md`,
`docs/user-guide.md`, `docs/setup-guide.md`, `docs/ubiquitous-language.md`
and `packages/extension/vss-extension.json`. Exactly one of the files it
reads is in the package that owns it, and that one is a manifest rather
than source. Rename a heading in the extension's Marketplace description
and the **bot's** suite goes red; delete a section from the README and the
same. `deploymentDocs.test.ts` sits beside it with the same shape — its
subject is `docs/deployment.md` and `.claude/CLAUDE.md`, and it walks
`packages/*/src` to get there.

This is the one place in the repo where a package reaches up and across.
Every other rule here is about not skipping past your neighbour:
`functions/` goes through `services/` goes through `storage/`, the vendor
SDK stays in one layer, cross-layer imports resolve through barrels. The
documentation tests were put in `packages/bot` because
`deploymentDocs.test.ts` was already there when Feature 4 needed a
sibling — build order, fossilised, for the third time in this repo.

**The markdown fixture became a library and nobody moved it.**
`src/test/fixtures/markdown.ts` is 465 lines holding four separate
engines: a fenced-block walker, a section reader, a GitHub slug
implementation with three non-obvious rules, a link resolver with its own
`Repo` port, and a surface scanner that parses JSON by dotted path. It
carries the longest doc comments in the package. It is, by every measure
this repo uses, production code — and it sits in `fixtures/`, which is
where the fakes and the domain builders live.

The proof is in its consumer. Of `userDocs.test.ts`'s 1,042 lines and 32
tests, roughly 500 lines and 20 tests are unit tests **of the fixture** —
`describe("GitHub heading slugs")`, `describe("the link resolver")`,
`describe("the unanimity scanner")` — driven against hand-built fake
repositories, with no involvement of this repo's documents at all. The
other 12 are the assertions about the documents. That is the exact shape
issue #14 found in the 1,800-line `App.test.tsx`: one file named for the
slice that produced it, holding two entirely different kinds of test.

And the split is incomplete in the other direction too. Several functions
that behave exactly like the extracted ones — `boldedTerms`, which reads
a bolded span across a line wrap; `withoutLinks`, which strips both
markdown links and autolinks; `stageNumbers`; `settingTokens` — never
made it out of the test file, so they have no tests of their own and are
exercised only as a side effect of asserting something else. Two of them
(`outsideFences`, `section`) are inside the fixture and are _also_
untested directly, despite `section` being the thing that makes the whole
Environment Variables check work.

**The documents themselves have no through-line.** The four documents are
individually good and their ownership is clean, but nothing was written
to be _read in order_:

- `docs/user-guide.md` is 283 lines with no contents list and no closing
  hand-off, while `docs/setup-guide.md` — the shorter read per section —
  has both. Two documents in the same set open and close differently.
- `docs/deployment.md` is 606 lines organised by prerequisite and opens
  straight into CORS. A reader routed there from a setup-guide stage
  lands mid-reference with nothing telling them they are in the lookup
  document rather than the walkthrough.
- Several paragraphs wrap mid-clause where an edit landed without a
  reflow (`docs/user-guide.md`'s Unreachable paragraph and its third
  ladder rung are the two clearest).
- Nothing checks that a document is _reachable_. The link resolver proves
  every link that exists points somewhere real; it says nothing about a
  document nobody links to. `docs/handoff/panel-layout-spec.md` and the
  card templates are reachable only through one README bullet, and a
  future document added to `docs/` would be reachable from nowhere and
  nothing would notice.
- The cross-reference check reads three documents — `README.md` and the
  two guides. `docs/deployment.md` gained back-links in issue #30 and
  `docs/ubiquitous-language.md` links out too; **neither has ever had a
  link checked**.

**Feature 4 never got its closing paperwork.** `README.md` still reports
Feature 4 as 🟡 In progress, `.claude/CLAUDE.md` still says "Not started",
`docs/dev-journal.md` has no entry for the feature or its build, and
issue #26 is open. The drift test that exists to catch precisely this
(`"no longer reports Teams Notifications as not started"`) is pinned to
Feature 3 by name, so it cannot catch Feature 4's.

## Solution

Give the documentation the same thing every other subject in this repo
has: **a workspace of its own, with layers, folder-per-module, barrels
and co-located tests.**

`packages/docs` is a fourth npm workspace whose subject is the
documentation. It ships nothing and has no `build` script. It holds the
markdown library as real modules — `lib/` for pure text, `repo/` for the
filesystem seam, `checks/` for the analyses — and, in `src/test/`, the
assertions about _this_ repo's documents. Both existing doc tests move
into it. `packages/bot` keeps only the tests whose subject is the bot:
`layerPolicy.test.ts` and `packaging.test.ts`.

The workspace costs almost nothing to stand up. `packages/*` already
globs it, and `.husky/pre-commit` fans `lint`, `typecheck` and `test` out
with `--workspaces --if-present`, so the gate picks it up with no edit to
any root script or hook. ESLint resolves the root flat config by upward
search, so the rules cannot drift. The move itself is close to free:
`packages/docs/src/test/` sits at the same depth as
`packages/bot/src/test/`, so `repoRoot` is the same four-level
`fileURLToPath` and every path constant in both test files is unchanged.

It also fixes something the current arrangement forced: `readDoc` calls
`expect` from `vitest`, because a fixture may. A module in `src/` may
not, so it becomes `readDocument`, which throws with the same message.
Nothing in `packages/docs/src/` outside `src/test/` imports vitest except
a co-located test.

Then the documents get the pass that makes them read as one set: a
contents list and a closing hand-off on every document that is read
straight through, a reference banner on the one that is not, reflowed
paragraphs, and two new mechanical checks — every link in **all five**
documents resolves, and every document under `docs/` is reachable from
the README by following links.

The accepted cost, taken deliberately: `readSourceFiles` is duplicated.
`packages/bot/src/test/layerPolicy.test.ts` still needs a source walker
and the moved deployment test needs one too. Sharing it means a
workspace-to-workspace dependency, which this repo has avoided since the
Feature 3 design log ruled it out for `NotificationMessage` and
`statusCodeOf`. Two copies of a 25-line walk, each next to its consumer,
each with its own test, is the same trade already recorded twice — and
this one is test-only, so it cannot reach a deploy at all.

## Commits

Every commit leaves all four suites green under `lint`, `typecheck` and
`test`. Baselines to hold against: bot 153/23, api 180, extension 191.
After Group B the bot is 113 across 21 files and the new workspace holds
the 40 that left.

### Group A — stand up the workspace

**A1. Scaffold `packages/docs`.** A `package.json` (`@prsync/docs`,
private, no `main`, no `build` script, `test` / `lint` / `typecheck`
scripts matching the other packages, devDependencies on vitest,
typescript and `@types/node`) and a `tsconfig.json` extending
`tsconfig.base.json` and including `src`. Its description says what the
workspace is: the tests whose subject is the documentation, shipping
nothing. Run `npm install` so the lockfile records the workspace. The
root `npm test` now runs a fourth suite that passes with no tests.

**A2. Add the workspace's own header document.** A short
`packages/docs/README.md` stating the three layers, the rule each obeys,
and the one thing that makes this workspace different from the other
three — it has no runtime, so its "product" is the repo's prose. No test
yet; this is what a reader lands on when they wonder why a `docs`
workspace exists next to a `docs/` directory.

### Group B — move the tests, unchanged

**B1. Move `markdown.ts` and `userDocs.test.ts`.** Both files move from
`packages/bot/src/test/` to `packages/docs/src/test/` with no edit other
than nothing at all — the relative import between them and the four-level
`repoRoot` are identical at the new depth. Bot: 121 across 22. Docs: 32
across 1.

**B2. Copy the source walker into the new workspace.**
`readSourceFiles` lands at `packages/docs/src/test/fixtures/sourceFiles.ts`
as a verbatim copy, with a header comment recording why it is a second
copy rather than a shared module, naming the two precedents. Not yet
consumed; the next commit consumes it.

**B3. Move `deploymentDocs.test.ts`.** It moves whole, including the
gitignore-gated `.claude/CLAUDE.md` describe, and points at the copied
walker. Its `packageRoot` constant becomes a repo-root-relative
`packages/bot` path, since it is now reading another workspace's source
as evidence rather than its own. Bot: 113 across 21. Docs: 40 across 2.

**B4. Record the duplication as an accepted cost.** Add the walker to the
accepted-costs section of `docs/deployment.md` alongside the queue
envelope and the status-code reader, with the same reasoning. This is a
documentation commit, and `deploymentDocs.test.ts`'s accepted-costs
assertion is what keeps it honest.

### Group C — the library becomes modules

Each commit here creates one folder-per-module with a co-located test,
removes the code from `markdown.ts` (or from the spec file), adds one
line to the layer barrel, and updates the importing spec. Every commit is
green. The order is bottom-up so no commit ever imports something that
does not exist yet.

**C1. The `repo/` layer: the port and the real repository.** `Repo`,
`repoAt`, and the layer barrel. `repoAt`'s co-located test covers the two
behaviours it actually has — a directory read yields `""`, a missing path
yields `""` — neither of which is currently asserted anywhere.

**C2. The fake repository fixture.** `packages/docs/src/test/fixtures/fakes.ts`
gains `fakeRepo(files)`, the in-memory `Repo` every check test drives. The
five or six hand-rolled inline fakes inside `userDocs.test.ts` collapse
onto it in the same commit. This is the `fakes.ts` pattern from the
extension and the bot, applied to the one port this workspace has.

**C3. `repo/readDocument/`.** Replaces `readDoc`; throws a labelled error
instead of calling `expect`, so `src/` stops importing vitest outside
tests. Its test asserts the message names the document by its repo-root
path, because that message is the whole feature.

**C4. `repo/sourceFiles/`.** The copied walker moves out of `fixtures/`
into the layer and gains its first co-located test in either workspace —
`node_modules` skipped, tests excluded by default, `exclude` honoured,
forward-slashed paths on any platform.

**C5. `lib/fences/`.** `outsideFences`, currently private and untested,
becomes the leaf module three other modules depend on. Its test pins the
rule that a fence line is itself "inside" — the reason a `#` shell
comment in `deployment.md` is not read as a heading.

**C6. `lib/section/`.** Moved with its fence-awareness intact; first
direct test. Covers the same-or-higher-heading boundary, the missing
heading answering `undefined`, and the fenced `# packages/api` case that
motivated it.

**C7. `lib/githubSlug/`.** Moved; the three existing slug tests move with
it unedited, which is the safety argument for the commit.

**C8. `lib/boldedTerms/`.** Lifted out of the spec file, where it has
never had a test of its own. Its test pins the wrapped-span behaviour the
doc comment describes — `**Round\nclosed**` is one term, not two.

**C9. `lib/settingTokens/`.** `SETTING_PATTERN`, `withoutLinks` and
`settingTokens` together, since the pattern means nothing without the
link-stripping rule. Its test pins both allowances: a linked setting
passes, a backticked one does not.

**C10. `lib/stages/`.** `STAGE_HEADING` and `stageNumbers`. Small, and
the only remaining spec-local helper with real logic.

**C11. `checks/unresolvedLinks/`.** The resolver moves with its ten unit
tests, now driven against `fakeRepo`. `MARKDOWN_LINK`, `isOutsideRepo`,
`headingSlugs` and `splitAnchor` go with it as module-private, since none
has a consumer outside it.

**C12. `checks/surfaceText/`.** The JSON-by-dotted-path reader and the
`Surface` type, with the four "yields nothing" cases as its test.

**C13. `checks/unanimityAliases/`.** The scanner, the alias list and
`withoutQuotations`, with the eight scanner tests moved across.

**C14. Delete `markdown.ts`.** It is empty by now; the three barrels are
the public API. The last spec imports switch from the file to the layer
barrels, which is what makes the two-rule import convention true in this
workspace too.

### Group D — the specs split by subject

**D1. `src/test/documents.ts` — the registry.** One module naming every
user-facing surface and document: the two guides, the three derived
surfaces, the cross-referenced set, the never-scanned paper trail, and
`LAST_STAGE`. Currently these constants are scattered across 200 lines of
`userDocs.test.ts` in the order the four build phases added them. As one
registry it is also the answer to "what counts as user-facing?", which is
a question the repo could not previously answer from one place.

**D2. Split out `setupSequence.test.ts`.** Assertions 1 and 2 — the stage
headings complete and ascending, and no setting token outside a link —
with the header comment explaining that both are structural and why.

**D3. Split out `glossary.test.ts`.** Assertion 4 — every bolded gloss
term exists verbatim in the ubiquitous language.

**D4. Split out `closeRule.test.ts`.** Assertions 5 and 6, the
has-something-to-scan floor, the Marketplace pointer, and both exclusion
tests. These belong together because they are one rule read over five
surfaces.

**D5. Split out `crossReferences.test.ts`.** Assertion 3, plus the
found-a-link-in-every-document floor. `userDocs.test.ts` is deleted in
this commit; its file header is redistributed to the four, each keeping
the honesty paragraph about its own assertion's strength.

**D6. Split `deploymentDocs.test.ts` in two.** `deploymentReference.test.ts`
keeps the five assertions about `docs/deployment.md`;
`projectInstructions.test.ts` takes the three gitignore-gated
`.claude/CLAUDE.md` ones, along with the skip rationale, which is easier
to find when it is the whole file's subject.

### Group E — the coverage the split makes obvious

**E1. Check the links in all five documents.** Add `docs/deployment.md`
and `docs/ubiquitous-language.md` to the cross-referenced set. Neither
has ever had a link resolved. Fix whatever it reports in the same commit
— if it reports nothing, the commit still stands, because the two
documents are now guarded.

**E2. `checks/reachable/`.** From `README.md`, follow relative links
transitively; report every `docs/**/*.md` no path reaches. Its test
drives the three cases against `fakeRepo`: a document linked directly, a
document linked only from a linked document, and an orphan.

**E3. Assert this repo has no orphaned document.** The repo-level
assertion, with any deliberate exception listed by path and reason rather
than filtered by pattern. Fix real orphans by linking them from the
README's paper-trail block.

**E4. Generalise the layer-table drift check.** The
`"documents every layer packages/bot/src actually has"` assertion reads
`packages/bot` by name. Make it read every workspace that has layers, so
`packages/docs`'s own three are guarded by the same rule that guards the
bot's six. Still inside the gitignore-gated describe.

**E5. Check the build status agrees with itself.** A feature the README
marks ✅ Complete and `.claude/CLAUDE.md` marks `- [ ]` is the drift that
shipped today. Replace the Feature-3-by-name assertion with one that
compares the two lists. Gitignore-gated, for the same reason as its
neighbours.

### Group F — the documents read as one set

**F1. `docs/user-guide.md`: contents and hand-off.** A contents list
under the opening paragraphs and a closing "Where to go next" matching
the setup guide's shape. No wording changes to the body.

**F2. `docs/user-guide.md`: reflow.** The paragraphs that wrap mid-clause,
re-wrapped at the repo's 80 columns. Not a wording change and not a
Prettier setting change — `proseWrap` stays `preserve`, because turning
it on would reformat every immutable design log in the repo.

**F3. `docs/setup-guide.md`: contents.** A stage contents list at the
top, linking each stage's heading — which also exercises assertion 3
against eleven anchors whose double-hyphen slug is the trap `githubSlug`
was written for.

**F4. `docs/deployment.md`: a reference banner and contents.** An opening
paragraph saying plainly that this is the lookup document and pointing a
first-time reader at the setup guide, plus a contents list over its
prerequisite sections. Its ownership does not change; only its front
door.

**F5. `README.md`: routing and structure.** The Documentation table
wording aligned with the five-document set, and `packages/docs` added to
the Project Structure tree.

**F6. `docs/ubiquitous-language.md`: a "who this is for" opening.** One
paragraph, so every non-immutable document opens the same way. Design
logs, PRDs and refactor plans are not touched — they are snapshots.

### Group G — close Feature 4

**G1. README Build Status.** Feature 4 to ✅ Complete, and the Tech Stack
testing row updated to name four workspaces rather than "both the
extension and API packages", which has been stale since Feature 3.

**G2. `.claude/CLAUDE.md`.** Feature 4 marked complete, `packages/docs`
added to the monorepo tree with its layer table and import rules, the
testing line corrected to four workspaces, the moved doc tests recorded,
and the duplicated walker recorded as an accepted cost. **This commit has
no git commit** — `.gitignore:32` excludes `.claude`, so the edit is
applied on disk and is effective for every future session, but it is not
versioned. Fifth recurrence; see G4.

**G3. `docs/dev-journal.md`.** One entry covering Feature 4's build and
this refactor: what the workspace move bought, the walker duplication and
why it was accepted, the `expect`-in-a-fixture problem, and what was left
undone.

**G4. File the two standing items and close #26.** A CI issue (GitHub
Actions running `lint`, `typecheck` and `test` across the four
workspaces — outstanding since refactor 03 and the thing that would have
caught the gitignore trap), and an issue asking the one question that has
now recurred five times: whether `.claude/CLAUDE.md` should be
force-added. Close issue #26.

## Decision Document

- **A fourth workspace, `packages/docs`, whose subject is the
  documentation.** Private, no `main`, no `build` script, so
  `npm run build --workspaces --if-present` skips it and no deploy target
  can ever include it. It is picked up by the existing `packages/*` glob
  and by the pre-commit gate's `--workspaces --if-present` fan-out, so no
  root script and no hook changes.
- **Three layers, following the conventions the other three packages
  already obey** — folder-per-module with a co-located test, exactly one
  barrel per layer as its public API, cross-layer imports through the
  target barrel, within-layer imports by direct file path:
  - `lib/` — pure text over markdown: fences, sections, GitHub slugs,
    bolded terms, setting tokens, stage numbers. The LEAF layer: imports
    no other layer, touches no filesystem, and every function has a test.
  - `repo/` — the filesystem seam. The `Repo` port, the real repository,
    the document reader and the source walker. The ONLY layer that
    performs I/O, which is what keeps every check drivable against a fake.
  - `checks/` — the analyses: unresolved links, unanimity aliases,
    surface text, reachability. Each takes a `Repo` and returns findings;
    none asserts, so each is testable without this repo's documents.
- **`src/test/` holds the assertions about this repo**, exactly as the
  other packages' `src/test/` holds what every layer's tests consume. It
  is the only place that binds a check to a real path.
- **`readDoc` becomes `readDocument` and throws instead of calling
  `expect`.** A fixture may import vitest; a module in `src/` may not.
  The failure message is unchanged, so the reader sees the same thing.
- **The `Repo` port stays**, and every new check takes it. It exists
  because the failures these tests guard against — a missing file, an
  anchor matching nothing, an orphaned document — are the things a
  correct repository cannot demonstrate. Same reasoning as
  `QueueProducer` and `TeamsSender`.
- **Both doc tests move; the two bot-subject tests stay.**
  `layerPolicy.test.ts` and `packaging.test.ts` interrogate the bot's
  source and its shipped artifact and remain in `packages/bot`.
- **`readSourceFiles` is duplicated, deliberately.** One copy per
  consumer workspace, each with its own test. The alternative is a
  workspace-to-workspace dependency, which this repo has declined twice
  before for `NotificationMessage` and `statusCodeOf`. Recorded in
  `docs/deployment.md`'s accepted costs and in the dev journal, so it
  reads as a decision rather than an oversight.
- **`src/test/documents.ts` is the registry of user-facing surfaces** —
  the two guides, the three derived surfaces, the cross-referenced
  document set, the never-scanned paper trail, and the pinned last stage.
  Adding a document is one entry there and no signature change anywhere,
  which is already the interface property `LinkCheck.documents` and
  `SurfaceScan.surfaces` were built for.
- **The cross-reference check grows from three documents to five.**
  `docs/deployment.md` and `docs/ubiquitous-language.md` are read as
  sources, not merely as targets.
- **Reachability is a new check, not a new document rule.** It answers
  "can a reader get here from the front door", which is the one thing the
  link resolver cannot say. Exceptions are listed by path with a reason.
- **Two drift checks are generalised** rather than re-pinned: the layer
  table check reads every workspace that has layers, and the build-status
  check compares the README's table against `.claude/CLAUDE.md`'s
  entries. Both stay inside the gitignore-gated describe.
- **`proseWrap` stays `preserve`.** Reflowing is done by hand in the two
  guides. Changing the Prettier setting would rewrite every design log,
  and design logs are immutable snapshots.
- **Document ownership does not change.** `user-guide.md` owns use,
  `setup-guide.md` owns sequence, `deployment.md` owns values, rationale
  and failures, `ubiquitous-language.md` owns terminology. Group F adds
  navigation to those documents and moves no content between them.
- **CI and the `.claude` gitignore question are filed, not solved.** Both
  have recurred across three refactors; each gets an issue so the next
  recurrence has somewhere to land.

## Testing Decisions

**What makes a good test here.** These tests have no runtime to drive, so
the external behaviour under test is _the answer a check gives about a
set of documents_. A good one states a fact about text — this link
resolves, this term appears verbatim, this sentence uses a forbidden
word — and can be driven from a fake repository with no reference to this
project's actual files. A bad one asserts how a check reached its answer,
or reads the document it is checking to derive what to expect from it,
which is a test agreeing with itself. `LAST_STAGE` is pinned by hand for
exactly that reason and stays pinned.

**The split the workspace makes explicit.** Two kinds of test live here
and they are separated by directory:

- **Module tests** (`src/lib/*/`, `src/repo/*/`, `src/checks/*/`) drive
  one function against `fakeRepo` or a string literal. They are the ones
  that can demonstrate failure, and they are where a bug in the library
  is caught.
- **Repo assertions** (`src/test/*.test.ts`) point the checks at this
  repository and expect no findings. They cannot demonstrate failure —
  a correct repo has nothing to report — which is why every one of them
  is paired with a floor: something was actually scanned, a link was
  actually found in every document, every surface yielded text.

**Modules that get a test they do not currently have:** `outsideFences`,
`section`, `boldedTerms`, `settingTokens` with `withoutLinks`,
`stageNumbers`, `repoAt`, `readSourceFiles`, `readDocument`, and the new
`reachable`. Modules whose existing tests move unedited — the safety
argument for their commits: `githubSlug` (3), `unresolvedLinks` (10),
`unanimityAliases` and `surfaceText` (8).

**Prior art in this repo.** `packages/bot/src/test/deploymentDocs.test.ts`
is the model for reading source and documentation together and for
recording its own assertions' weakness honestly.
`packages/bot/src/test/fixtures/fakes.ts` and
`packages/extension/src/test/fixtures/` are the model for one complete
typed fake per port, which `fakeRepo` follows.
`packages/api/src/services/QueueNotificationPort` and
`packages/bot/src/teams/TeamsSender` are the model for the structural
port that makes the untestable drivable. The four-file split of
`App.test.tsx` in refactor 02 is the model for naming a spec file after
its subject rather than the slice that produced it.

**What stays honest about strength.** Each moved assertion keeps the
paragraph recording whether it is structural or strong and what it does
not claim. None of them checks prose quality; the two guides still get a
human read-through before they merge, and Group F's changes are the kind
that need one.

## Out of Scope

- **CI.** Filed as its own issue. It is the thing that would catch a
  broken suite on a fresh clone, and it has wanted an issue since
  refactor 03 — but adding a pipeline is not this refactor.
- **Force-adding `.claude/CLAUDE.md`.** Filed as its own issue. It
  overrides a deliberate `.gitignore` choice and is the author's call.
- **Any product code.** Nothing under `packages/*/src` outside
  `src/test/` changes. No card, no contract, no setting, no behaviour.
- **Rewriting the guides' voice.** Group F adds navigation, reflows
  paragraphs and adds one opening paragraph. It does not re-register the
  prose. The gloss section quotes canonical terms verbatim and the panel
  copy is quoted exactly; a friendlier rewrite is what the unanimity
  scanner exists to catch.
- **Moving content between documents.** Ownership was settled in the
  design log and holds.
- **Screenshots**, ruled out in the design log and still ruled out.
- **In-panel help.** Still product code, still not this feature.
- **Surfacing Unreachable in the panel.** The user guide's ladder still
  ends at the operator, honestly. Changing that needs an API read path
  and panel state, neither of which is modelled.
- **A published Marketplace listing page** and **real
  `privacyUrl` / `termsOfUseUrl` pages.** Unchanged from the design log.
- **The `packages/api` four-handler duplication.** Outstanding since
  refactor plan 02, belongs to `round-lifecycle`, still wants its own
  issue.

## Further Notes

**The depth coincidence is what makes Group B cheap.**
`packages/docs/src/test/` and `packages/bot/src/test/` are both four
levels below the repo root, so `fileURLToPath(new URL("../../../../",
import.meta.url))` is correct in both and every repo-relative constant in
both test files survives the move untouched. That is why the move happens
before the decomposition rather than after: the riskiest-looking commit
in the plan is the one that changes the least.

**This is the third time build order has fossilised into structure.**
`App.test.tsx` (issue #14), `BotHost` (issue #25), and now the
documentation tests living in the bot. Each time the tell was the same:
a name or a location that describes _when_ something was written rather
than _what it is about_. Worth noticing that all three were found by the
same question — "what is this file's subject?" — and that in all three
cases the tests had already split before the source did.

**The workspace has a second effect worth having.** Once
`packages/docs` exists, a check about the documentation has an obvious
home, and the cost of adding one drops to a folder and a barrel line.
Reachability (Group E) is the first check nobody would have written while
the only home for it was inside the Teams bot's test directory.

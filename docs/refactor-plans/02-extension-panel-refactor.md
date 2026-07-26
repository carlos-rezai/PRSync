# 02 — Extension Panel: test architecture, hooks layer, and de-duplication

> Initiative: `extension-panel` · Refactor plan for `packages/extension`
> Issue: https://github.com/carlos-rezai/PRSync/issues/14

Cleanup pass over `packages/extension` after Feature 2 shipped through
issues #8–#13. No panel behaviour changes and no API contract changes:
what the viewer sees, which endpoint each control calls, and how drift is
detected all stay exactly as they are. What changes is the shape of the
code and its tests — a shared typed test-fixture module, per-module tests
where none existed, the container's state machine lifted into a `hooks/`
layer, two rounds of de-duplication, comments rewritten off the build
narrative, and the repo's dead ESLint setup made real.

Baseline at the time of writing: 106 tests green across 10 files,
`typecheck` clean, `lint` **broken repo-wide** (see commit group 0).

## Problem Statement

Feature 2 was built as six sequential vertical slices, each landing as its
own issue. That was the right way to build it and the wrong shape to leave
behind: the build order is now fossilised in the code, and several
shortcuts that were reasonable inside a single slice have compounded
across six.

**The test file is organised by build phase, not by behaviour.**
`App.test.tsx` is 1,800 lines and 61 tests under eleven `describe` blocks
named for the slice that produced them — `"App — Phase 1 read-only load
paths"` through `"App — Phase 6 theming"`. A developer looking for how the
panel behaves when a reviewer's toggle fails has to know which week it was
written in. Section banner comments (`// --- Phase 3: Ready for review`)
reinforce a structure that means nothing to anyone reading the code today.

**Each slice grew its own fake factories rather than widening the last
one's.** The file now carries four generations of API fake (`makeApi`,
`makeApiP2`, `makeApiP3`, `makeApiP4`) and three of ADO fake (`makeAdo`,
`makeAdoP3`, `makeAuthorAdo`), because the Phase 1 fake was defined as
`{ getCurrentRound } as ApiClient` and every later slice needed a method
it did not have. There are nine type assertions in the file
(`as ApiClient`, `as unknown as AdoClient`, `as unknown as { resize: … }`)
whose entire purpose is to let a partial object stand in for a complete
interface. Under those casts, calling an unstubbed method fails as
`TypeError: x is not a function` rather than as a clear "you didn't stub
this". One of the casts is already stale — its comment says _"Cast because
Phase 6 adds `resize` to the seam; drop the cast once `SdkClient` declares
it"_, and `SdkClient` has declared it since issue #13 landed.

**The mutation skeleton is written out four times in the container.**
`App.tsx` is 474 lines, and its four handlers — Done toggle, label edit,
cancel round, open round — each repeat the same seven steps: clear the
error slot, raise the in-flight flag, run the call through
`withSingleRetry`, commit the returned round, route a failure through
`mapApiError`, surface or swallow the message, lower the flag. Only the
middle differs. This is the panel's exact analogue of the duplication
across Feature 1's four mutating handlers, which plan 01 deliberately left
out of a move-only refactor — the debt was named there and is now being
paid on the other side of the wire.

**The API client repeats its fetch skeleton five times.** Roughly 90 of
`ApiClient`'s 174 lines are the same shape five times over: await the
token, build the `Authorization` header, add `Content-Type`, check
`response.ok`, throw `ApiError(status, readErrorCode(response))`, cast the
JSON to `Round`. Adding a sixth endpoint means copying it a sixth time,
and the five `as Round` assertions are five places to change rather than
one.

**Whole modules have no tests at all.** `ApiClient`, `ApiError` and
`AdoClient` are untested: nothing anywhere asserts that the round-open URL
is built correctly, that the PR key is URL-encoded into the path, that a
`204` becomes `null`, that an unparseable error body yields a `null` code,
or that ADO's `IdentityRefWithVote` maps onto `AdoReviewer` the way the
snapshot depends on. All eleven components in `components/` are exercised
only transitively through `App.test.tsx`, so a component's own rendering
rules are asserted through the full container render or not at all — which
is both slow and imprecise, and contradicts both `.claude/CLAUDE.md`'s
co-location rule and the design log's Q13 decision to mirror the API
package's discipline.

**The comments narrate how the code was built, not what it is.**
`ApiClient` opens with _"Phase 4 completes the round's write surface — the
Phase 1 current-round read, the Phase 2 own-row Done toggle…"_; `AdoClient`
says _"In Phase 1 it is consulted at exactly one moment"_ and then lists
what later phases would add; `packaging.test.ts` still labels a test
_"GREEN BEFORE THE IMPLEMENTATION"_. Worst of these, `ErrorState` promises
_"The richer, code-aware recovery messages (mapApiError) arrive in Phase 5;
Phase 1 shows a single retry prompt"_ — Phase 5 landed and `ErrorState`
never changed, so the comment now documents a behaviour the code does not
have.

**`npm run lint` has never worked.** ESLint 9 and `@typescript-eslint` are
installed at the root, but there is no `eslint.config.js` anywhere in the
repo, so the script fails identically in both packages with _"ESLint
couldn't find an eslint.config file"_. It goes unnoticed because
`.husky/pre-commit` runs `lint-staged` (which is configured for Prettier
only), `typecheck`, and `test` — never `lint`. `.claude/CLAUDE.md`
advertises "ESLint + Prettier + Husky (root-level, shared across
packages)"; two of those three are real. The rules that would have caught
the nine unnecessary casts, and that will guard the new hooks layer's
rules-of-hooks correctness, are configured nowhere.

**The paper trail is stale.** `.claude/CLAUDE.md` still records Feature 2
as "Not started" although all six of its issues are closed, and
`docs/dev-journal.md` has no entry for the panel build at all — its newest
entry is the Feature 1 refactor from two days earlier.

## Solution

Nine groups of work, ordered so that every commit leaves the suite green
and so that each piece of code is covered by tests _before_ it is
restructured.

**Make the linter real (group 0).** Add a root flat `eslint.config.js`
covering both packages, wire `lint` into the pre-commit hook, and fix what
it reports in `packages/extension`. Findings in `packages/api` are
recorded and filed separately rather than dragged into an extension-panel
refactor. Doing this first means every later commit is checked by it.

**Give the tests one typed fixture module (group 1).** A shared
`src/test/fixtures/` beside the existing `setup.ts` exports the round and
reviewer builders and exactly one fake per injected client — each
implementing its interface _completely_, with unstubbed methods rejecting
with an explicit "not stubbed in this test" error rather than being
absent. All four API-fake generations, all three ADO-fake generations and
all nine casts are deleted.

**Split the test file by behaviour (group 2).** `App.test.tsx` becomes
five sibling files in the same folder, each named for what it covers —
load, mutations, polling, errors, host — with every `describe` renamed off
the phase vocabulary. Pure moves: the same assertions, the same 61 tests.

**Fill the genuine coverage gaps (group 3).** Co-located tests for
`ApiError`, `ApiClient` and `AdoClient`, written _before_ the client
de-duplication that they exist to protect.

**Test the components where they live (group 4).** A co-located test for
each of the eleven components, one commit at a time (with the four static
state components sharing one).

**Move coverage down, don't duplicate it (group 5).** With component tests
in place, strip from the App test files only those assertions that check a
component's own rendering. What remains asserts orchestration: which
client got called, with what, in what order, and what the panel did with
the result.

**Collapse the two duplications (groups 6 and 7).** `ApiClient` gains one
private request helper and its five methods shrink to their differences.
`ApiError` moves down into `lib/` — it is a dependency-free value type and
belongs next to the `mapApiError` that interprets it — which is what makes
it legal for `withSingleRetry` to move out of the container into `lib/`
with a test of its own, without `lib` ever importing `api`.

**Lift the state machine into a `hooks/` layer (group 8).** A new layer
with its own barrel, following the same folder-per-module and import rules
as every other layer. `usePanelState` takes the load sequence, the settle
logic, the drift baseline and commit, the poll and resize effects, and the
four mutations behind a single shared skeleton. `App.tsx` is left as
render wiring at roughly 120 lines. The panel's DOM behaviour is
unchanged throughout, so the group 2 test files are the net.

**Rewrite the comments and the paper trail (groups 9 and 10).** Every
comment describes what its module is and why it is that way, keeping the
durable references — panel-layout-spec row numbers, ubiquitous-language
pointers, the reasoning behind decisions like keying the label field on
the stored value — and dropping every "Phase N". `.claude/CLAUDE.md` and
`docs/dev-journal.md` catch up with reality.

Every commit message uses the project convention:
`<type>: [extension-panel] issue #14 <description>`, with `refactor:`,
`test:`, `chore:` or `docs:` as appropriate.

## Commits

### Group 0 — make the linter real

1. **Add the root flat ESLint config.**
   `eslint.config.js` at the repo root: `typescript-eslint` recommended
   plus type-checked rules, `no-explicit-any` as an error, `no-console`
   as an error for `packages/extension` (the CLAUDE.md rule that nothing
   goes in the extension bundle) and allowed via the API's logger in
   `packages/api`, and `eslint-plugin-react-hooks` scoped to
   `packages/extension`. Ignore `dist/`, `node_modules/`, and build
   output. Add `eslint-plugin-react-hooks` to the root devDependencies.
   _Green: `npm run lint` now runs rather than erroring out. It is
   expected to REPORT findings at this point — do not fix them here._

2. **Record the baseline findings.**
   Capture the full `npm run lint` output for both workspaces into the
   issue as a comment (not into the repo). Nothing changes on disk. This
   is what makes the next commit's scope, and the follow-up api issue,
   honest rather than guessed.

3. **Fix the extension's lint findings.**
   Only `packages/extension`. Expect these to be dominated by the
   unnecessary type assertions in `App.test.tsx` — if the fixture work in
   group 1 would delete a finding anyway, disable the rule inline with a
   comment pointing at this issue rather than fixing it twice, and remove
   the suppression in group 1. `npm run lint --workspace @prsync/extension`
   is clean at the end of this commit.

4. **Wire lint into the pre-commit hook.**
   Add `npm run lint` to `.husky/pre-commit`, before `typecheck`. Leave
   `.lintstagedrc` as-is (Prettier over all staged files). Note that this
   will fail commits until the api package is clean, so this commit lands
   only once `--workspace @prsync/extension` is scoped into the hook, or
   after the api findings are resolved — decide from commit 2's output and
   record which in the commit body.

5. **File the api-package lint findings as their own issue.**
   No repo change. A separate issue under the `round-lifecycle` initiative
   carrying the captured output, so Feature 1's code is cleaned
   deliberately rather than as collateral.

### Group 1 — one typed fixture module

6. **Add the round and reviewer builders.**
   `src/test/fixtures/fixtures.ts`: the shared ids (author, two reviewers,
   stranger, project, repo), `makeReviewer`, `makeRound`, `makeAdoReviewer`
   and `makeAdoPullRequest`, all taking an overrides object and all fully
   typed against `lib`'s `Round`/`RoundReviewer` and `ado`'s
   `AdoReviewer`/`AdoPullRequest`. Nothing imports it yet.
   _Green: no existing file changed._

7. **Add the typed client fakes.**
   `src/test/fixtures/fakes.ts`: `makeSdk`, `makeApi`, `makeAdo` and
   `renderApp`. Each fake implements its interface COMPLETELY — every
   `ApiClient` method present — accepting an overrides object for the ones
   a given test drives. Unstubbed methods are `vi.fn()` implementations
   that reject with an explicit "`<method>` was called but not stubbed in
   this test" error. No type assertions anywhere: if a fake does not
   satisfy its interface, that is a compile error, which is the point.
   Still unused.

8. **Repoint `App.test.tsx` at the fixtures module.**
   Delete `makeReviewer`, `makeRound`, `makeSdk`, `makeApi`, `makeApiP2`,
   `makeApiP3`, `makeApiP4`, `makeAdo`, `makeAdoP3`, `makeAuthorAdo`,
   `adoReviewer`, `renderApp` and `resizeSpy` from the file, importing
   their replacements instead. Remove all nine type assertions and any
   inline lint suppressions added in commit 3. No assertion changes, no
   describe changes.
   _Green: still exactly 61 tests in this file, 106 in the suite._

### Group 2 — split the App tests by behaviour

Each of these is a pure move: the assertions inside a `describe` are
untouched, only its file and its name change. Verify by test count — the
suite stays at 106 after every one.

9. **Extract `App.load.test.tsx`.**
   Move the `Phase 1 read-only load paths` describe (9 tests), renamed to
   describe the behaviour: the initial `getCurrentRound`, the `200` path
   that derives everything from the round without an ADO call, the `204`
   path's single `createdBy` read, viewer-role selection, the two empty
   states, and the load-failure state.

10. **Extract `App.polling.test.tsx`.**
    Move `Phase 5 polling` and `Phase 5 drift + refresh banner`, renamed
    for the poll cadence, the suspension rules (hidden tab, in-flight
    mutation, unsettled panel), fingerprint-versus-baseline comparison,
    the banner, and the baseline reset on the viewer's own mutation.

11. **Extract `App.errors.test.tsx`.**
    Move `Phase 5 error surface`, renamed for the `mapApiError` recovery
    routing and the single retry.

12. **Extract `App.host.test.tsx`.**
    Move `Phase 6 autosize`, `Phase 6 autosize on drift` and
    `Phase 6 theming`, renamed for the host contract: asking the host to
    re-measure after every render, and the ADO theme cascade.

13. **Rename the remainder to `App.mutations.test.tsx`.**
    What is left is the Done toggle, Ready for review, label edit and
    cancel round describes; rename the file and rename those four
    describes off the phase vocabulary. Delete the `// --- Phase N:`
    section banners. There is no longer a file called `App.test.tsx`,
    which is intended — the module folder holds several behaviour-named
    test files.

### Group 3 — cover the untested client modules

Written before the code they cover is restructured, so group 6 has a net.

14. **Test `ApiError`.**
    Co-located `api/ApiError/ApiError.test.ts`: carries `status` and
    `code`, is an `instanceof Error`, has the `ApiError` name, and renders
    the code into its message only when there is one.

15. **Test `ApiClient.getCurrentRound`.**
    Co-located `api/ApiClient/ApiClient.test.ts` driven by a fake `fetch`
    and a fake token getter: the request URL (including the PR key
    URL-encoded into the path), the `Authorization: Bearer` header, `200`
    yielding the parsed round, `204` yielding `null`, a non-OK status
    throwing an `ApiError` carrying that status and the body's `code`, and
    an unparseable error body yielding a `null` code.

16. **Test the four mutating `ApiClient` methods.**
    One describe each for `toggleDone`, `openRound`, `editLabel` and
    `cancelRound`: the URL and HTTP method, the `Content-Type` header, the
    serialised body, the returned round, and the `ApiError` on failure.
    Include the case that matters to the compose form's contract — an
    `undefined` label is absent from the serialised `openRound` body, so
    the API generates the canonical wording.

17. **Test `AdoClient`.**
    Co-located `ado/AdoClient/AdoClient.test.ts` against a stubbed
    `GitRestClient`: the `IdentityRefWithVote` to `AdoReviewer` mapping
    (id, display name, `uniqueName` to email, required and container
    flags) and the `createdBy` to author-fields mapping, plus that the PR
    is fetched by id and project. This is the one place `vi.mock` is
    justified — the module boundary the DI seam exists to avoid is exactly
    what is under test here; note that in the file so it does not read as
    a violation of the testing seam decision.

### Group 4 — test the components where they live

There are **eleven** components, not eight as first counted. One commit
each, except the four static state components which share one.

18. **Test the four static state components.**
    `PanelHeader`, `LoadingState`, `ErrorState` and `EmptyState`: each
    renders its native `azure-devops-ui` element with the expected text,
    and `EmptyState` renders its optional secondary text only when given.

19. **Test `StatusPill`.** The derived text for each round status: "N of M
    reviewed" while open (counting only reviewers marked done), "All
    reviewed" once closed, "Cancelled" once cancelled.

20. **Test `ReviewerList`.** One row per snapshotted reviewer, each with
    its display name and Done state; only the viewer's own row is
    interactive and only when `canToggleOwn`; every other row and every
    row for a non-reviewer is disabled; clicking the own row calls up
    exactly once.

21. **Test `RoundLabel`.** Plain text when not editable; a text field when
    editable; blur and Enter both commit the exact typed text; an
    unchanged value commits nothing.

22. **Test `CancelRoundControl`.** The button opens the confirmation
    dialog and calls nothing; dismissing changes nothing; confirming calls
    up exactly once and closes the dialog.

23. **Test `RefreshBanner`.** Informational severity, the drift copy, and
    a Refresh action that calls up.

24. **Test `ComposeForm`.** The label field pre-fills with the derived
    default and follows the phase toggle while untouched; an untouched
    label submits as `undefined` and an edited one submits its exact text;
    the chosen phase is submitted; Ready is disabled with a hint when
    there are no eligible reviewers, and disabled while submitting; the
    open error renders when present.

25. **Test `RoundView`.** The composition rules: the label is editable and
    the cancel control present only for the author on an open round; the
    own-row toggle is live only for a reviewer on an open round; every
    terminal round is frozen for everyone; the inline mutation error
    renders when present; the label field is re-keyed on the stored label
    so a returned round replaces a stale draft.

### Group 5 — move coverage down rather than doubling it

An assertion moves out of the App tests only if it checks what a component
renders from its props. It stays if it checks orchestration. Each commit
states its before and after test counts in the body.

26. **Thin `App.load.test.tsx`.** Drop the status-pill wording assertions
    (now `StatusPill`'s) and the empty-state copy assertions (now
    `EmptyState`'s), keeping the assertions about which client was called,
    how many times, and which view the panel chose.

27. **Thin `App.mutations.test.tsx`.** Drop the per-role checkbox
    enabled/disabled matrix (now `ReviewerList`'s and `RoundView`'s), the
    dialog open/dismiss mechanics (now `CancelRoundControl`'s), and the
    label read-only rendering (now `RoundLabel`'s). Keep the optimistic
    flip and its reconciliation, the ADO-read-then-openRound ordering, the
    exact request payloads, and the revert-on-failure behaviour.

### Group 6 — de-duplicate the API client

Each step is covered by group 3's tests, which must not need editing.

28. **Introduce the request helper and convert the read.**
    A private helper inside `ApiClient` owning the token fetch, the
    headers, the `response.ok` check, the `ApiError` construction and the
    JSON parse, generic over the response type. Convert `getCurrentRound`
    first — its `204`-to-`null` case is the awkward one, so proving the
    helper handles it comes before the four that are straightforward.

29. **Convert `toggleDone` and `editLabel`.**

30. **Convert `openRound` and `cancelRound`, and delete the leftovers.**
    Only one `as Round` assertion remains in the file, inside the helper.

### Group 7 — move the error type and the retry policy into `lib`

31. **Move `ApiError` into `lib/`.**
    The module and its test move to `lib/ApiError/`; the `lib` barrel
    gains it, the `api` barrel drops the re-export, and `ApiClient`,
    `App.tsx` and the App test files import it from `lib` instead. It is a
    dependency-free value type and it belongs beside the `mapApiError`
    that interprets it — and `lib` must remain the leaf layer, which is
    what makes the next commit possible.

32. **Move `withSingleRetry` into `lib/` with a test.**
    Out of `App.tsx` into `lib/withSingleRetry/`, with the co-located test
    that CLAUDE.md's "every function in `lib/` must have a test" rule
    requires: passes a success through untouched; retries exactly once
    when the failure is a retry-class `ApiError`; never retries any other
    failure; propagates the second failure when the retry also fails.

### Group 8 — lift the state machine into a `hooks/` layer

The panel's DOM behaviour does not change in this group, so the group 2
test files must pass unedited after every commit. That is the whole safety
argument for the extraction.

33. **Create the `hooks` layer and move the read side.**
    `hooks/index.ts` as the layer barrel plus `hooks/usePanelState/`. Move
    the load state, the refs, `commit`, `settle`, `resolveReadyState`,
    `routeFailure`, the load effect, the poll effect and the resize effect
    out of `App.tsx` verbatim. The hook temporarily returns its internals
    so the four handlers, still in `App.tsx`, can consume them — an
    intermediate state that the next commit removes. Cross-layer imports
    go through barrels, within-layer imports by direct path, exactly as in
    every other layer.

34. **Move the four handlers into the hook.**
    The handlers move verbatim; the hook now exposes only the panel's
    state and its named actions, and stops returning refs and internal
    callbacks. `App.tsx` becomes render wiring: derive the viewer, choose
    the body, pass props. It should land around 120 lines.

35. **Collapse the four handlers onto one skeleton.**
    A single private mutation runner inside the hook owning the shared
    seven steps — clear error, raise in-flight, run through
    `withSingleRetry`, commit, route the failure, surface or swallow,
    lower in-flight — parameterised by the call to make, the state to
    commit and the error slot to write. The four handlers reduce to their
    differences: the toggle's optimistic flip and revert, the label's
    pass-through, the cancel's settle-after-terminal, and the open's
    fresh-ADO-read-then-open with its separate error slot.

36. **Audit for transitions the DOM cannot reach.**
    Add `usePanelState.test.ts` only for state transitions that the App
    test files genuinely cannot observe through the rendered panel. A
    hook's external behaviour is its return value and its effects, so
    testing it directly is legitimate — but duplicating what the DOM
    already proves is not. If the audit finds nothing uncovered, record
    that in the commit body and add no file; that is a valid outcome.

### Group 9 — comments describe what the code is

Split by layer to keep each commit reviewable. No code changes in this
group at all.

37. **De-phase the `components/` comments.**
    Keep the panel-layout-spec row numbers, the ubiquitous-language
    pointers, and the reasoning worth keeping — why cancelling needs a
    confirmation, why the label field is re-keyed on the stored label, why
    the banner is the whole update path. Drop every "Phase N".
    `ErrorState`'s comment in particular is rewritten to describe what it
    actually shows, since it currently promises error mapping the
    component never received.

38. **De-phase the `api/`, `ado/` and `sdk/` comments.**
    `ApiClient`'s header stops narrating which slice added which method
    and describes the client's contract instead; `AdoClient`'s stops
    saying it is consulted at one moment "in Phase 1" and states the rule
    that actually holds — ADO's live PR is read at load only when a
    compose form may follow, and at the Ready-for-review click.

39. **De-phase the `App/`, `hooks/` and test comments.**
    Including `packaging.test.ts`'s "GREEN BEFORE THE IMPLEMENTATION" note
    and its "Issue #13 / PRD #7 Phase 6" trailer, and the PRD phase
    markers throughout the container's comments. Keep the PRD references
    themselves where they explain a decision — drop only the phase
    numbering.

### Group 10 — the paper trail

40. **Update `.claude/CLAUDE.md`.**
    Mark Feature 2 complete with its real test count; document the
    extension's layers — `sdk`, `api`, `ado`, `lib`, `hooks`, `components`
    and the `App` container — and note that they follow the same
    folder-per-module, one-barrel-per-layer, cross-layer-through-barrels
    rules as `packages/api`. Record the ESLint config as the third leg of
    the linting setup that the Tech Stack section already claims.
    **Note:** `.claude/` is gitignored (`.gitignore:32`), so this edit
    lands on disk but is not committable without `git add -f` — exactly
    the situation plan 01's commit 20 hit. Apply the edit, do not
    force-add, and say so in the dev journal.

41. **Update `docs/dev-journal.md`.**
    Two entries: one for the Feature 2 panel build (currently missing
    entirely — the journal's newest entry is Feature 1's refactor), and
    one for this refactor recording the outcome, the `hooks/` layer, the
    ESLint discovery, and the CLAUDE.md gitignore caveat again.

## Decision Document

- **Scope:** `packages/extension` in full, plus a new root ESLint config
  and a one-line pre-commit hook change. `packages/api` is read for
  reference and its lint findings are recorded, but its code is not
  touched.
- **No behaviour change.** What the viewer sees, which control calls which
  endpoint, how the viewer's role is derived, the poll cadence and its
  suspension rules, the drift fingerprint's inputs, the error-to-recovery
  mapping and the single retry all stay exactly as they are. No HTTP
  contract, request payload or response handling changes.
- **A new `hooks/` layer.** The design log's package layout did not
  anticipate one; it is added rather than the container being left at 474
  lines. It follows every existing rule — its own folder-per-module
  layout, exactly one barrel as its public API, cross-layer imports
  through the target barrel, within-layer imports by direct path. Design
  logs are immutable, so this deviation is recorded here and in
  `.claude/CLAUDE.md`, not by editing `docs/design-logs/02-extension-panel.md`.
- **One hook, not two.** The load sequence, the drift baseline and the
  mutations all share the same commit path, the same failure routing and
  the same in-flight flag. Splitting them into separate hooks would mean
  threading those between them, which is worse than one cohesive module.
- **`ApiError` moves into `lib`.** It is a dependency-free value type,
  it belongs beside the `mapApiError` that interprets its status and code,
  and — decisively — `lib` is the leaf layer and must never import `api`,
  so `withSingleRetry` could not otherwise live in `lib` at all.
- **`withSingleRetry` becomes a `lib` module.** It is a pure policy
  function over a promise-returning call, and CLAUDE.md requires every
  `lib` function to have a test; as a private function inside the
  container it had neither a home nor one.
- **Test fakes implement their interfaces completely.** A partial object
  behind a type assertion is what produced four generations of API fake.
  Complete fakes with loud, explicit failures for unstubbed methods mean a
  test that reaches for something it did not set up says so, and adding a
  method to a client interface becomes a compile error in one place rather
  than a runtime surprise in many.
- **Fixtures live under `src/test/`, not in a module folder.** That
  directory already exists and already sits outside the layer conventions
  (it holds the Vitest setup and the packaging contract tests, and has no
  barrel). Component, client and container tests all consume the fixtures,
  so putting them inside any one module's folder would force imports
  upward and across layers.
- **Several test files per module folder.** The convention is co-located
  tests, not one file; a container with five distinct behavioural surfaces
  gets five behaviour-named test files rather than one 1,800-line file.
  There is deliberately no `App.test.tsx` afterwards.
- **Component-level assertions move down; they are not duplicated.** The
  rule: if it only checks what a component renders from its props, it
  belongs in that component's test. If it checks which client was called,
  with what, in what order, or what the panel did with the result, it
  belongs in the container's.
- **`vi.mock` is used exactly once**, in `AdoClient`'s test, because the
  module boundary the DI seam exists to avoid is the thing under test. The
  DI-fakes decision from the design log's Q14 stands everywhere else.
- **ESLint enforcement is extension-only in this refactor.** The config is
  written for both packages so the repo has one shared setup, but fixing
  Feature 1's findings inside an extension-panel refactor would make this
  change something other than what it says it is. Those findings get their
  own issue under the `round-lifecycle` initiative.
- **Commit ordering:** the linter first so it checks everything after it;
  then fixtures, because every later test commit depends on them; then
  tests before the code they protect (group 3 before group 6, group 4
  before group 5, group 2 before group 8); then the de-duplications
  leaf-first (`api` client, then `lib`, then the container); then comments
  and docs last, when the code they describe has stopped moving.

## Testing Decisions

- **What makes a good test here.** It asserts what a caller can observe:
  for a component, what renders from a given set of props and what it
  calls up on interaction; for a client, the request it issues and the
  value or error it produces; for the container, which injected client it
  called, with what, in what order, and which view resulted. It never
  asserts internal component structure, private state, hook internals,
  file layout or import paths. The existing suite is largely written this
  way already — which is precisely why a 40-commit restructuring can be
  driven by it.
- **The suite is the safety net, and it is measured.** Every commit runs
  `npm run test --workspace @prsync/extension` and
  `npm run typecheck --workspace @prsync/extension`; from group 0 onward,
  `npm run lint --workspace @prsync/extension` too. Move and split commits
  must leave the total test count unchanged (106 at the start). Additive
  commits raise it. The two thinning commits lower it deliberately, and
  each states its before and after counts in the commit body so a
  reviewer can see the reduction was intended rather than accidental.
- **Modules gaining their first tests:** `api/ApiError`, `api/ApiClient`,
  `ado/AdoClient`, and all eleven components — `PanelHeader`,
  `LoadingState`, `ErrorState`, `EmptyState`, `StatusPill`,
  `ReviewerList`, `RoundLabel`, `CancelRoundControl`, `RefreshBanner`,
  `ComposeForm`, `RoundView`. Plus `lib/withSingleRetry` once it exists as
  a module, and `hooks/usePanelState` only where the DOM cannot reach.
- **Modules already covered, whose tests only move:** every `lib` helper
  (`buildPrKey`, `deriveRole`, `deriveDefaultLabel`, `hasEligibleReviewers`,
  `mapApiError`, `roundFingerprint`), `sdk/SdkClient`, `sdk/initPanel`,
  and the packaging contract tests.
- **Prior art in this repo.** The `lib` helper tests are the model for
  pure-function tests. `App.test.tsx`'s existing approach — drive the real
  component tree through `@testing-library/react` with injected fakes,
  assert on roles and visible text rather than markup — is the model for
  both the component tests and the container tests; the work here changes
  where those tests live and what they are named, not how they are
  written. `packages/api`'s `RoundService.test.ts` is the model for
  testing a unit against complete in-memory fakes rather than partial
  mocks, which is exactly what the fixtures module brings to this package.
- **The fake `fetch` in the client tests** replaces the global for the
  duration of a test and restores it afterwards, asserting on the
  arguments it received. This is the only reasonable seam for a module
  whose entire job is to construct requests.

## Out of Scope

- **Fixing `packages/api`'s lint findings.** Recorded in commit 2 and
  filed as their own issue under `round-lifecycle` in commit 5.
- **Wiring `mapApiError` into the load-failure path.** `ErrorState`'s
  comment promises code-aware recovery messages the component never
  received; this refactor corrects the comment to describe what the code
  does, because changing what a failed load shows the viewer is a
  behaviour change and belongs in its own issue. Flag it as a follow-up
  when filing.
- **Any panel behaviour change**, including the poll cadence, the drift
  fingerprint's field list, the retry count, role derivation, and every
  request payload.
- **Any change to `packages/api` or `packages/bot` code**, to the HTTP
  contract, or to the round schema.
- **`docs/design-logs/02-extension-panel.md`** — immutable by convention;
  the `hooks/` layer deviation is recorded in this plan and in
  `.claude/CLAUDE.md` instead.
- **`docs/handoff/panel-layout-spec.md`** — the panel already matches it;
  no layout changes here.
- **Feature 3 (Teams notifications)** and everything in the Deferred list.
- **A README** — the repo has none, and the conventions live in
  `.claude/CLAUDE.md`.
- **Splitting `App.mutations.test.tsx` further.** It holds four describes
  and will be the largest of the five after group 5's thinning; if it is
  still unwieldy then, that is a judgement call to make with the real
  numbers in hand, not to pre-commit to here.

## Further Notes

- **The `.claude/` gitignore trap will recur.** Plan 01's commit 20 could
  not be committed because `.gitignore:32` excludes `.claude/`, so the
  convention documentation lives on disk and outside version control.
  Commit 40 hits the same wall. Apply the edit — future Claude sessions
  read the on-disk file, so it is genuinely effective — but do not
  `git add -f` without the author's decision, and record the situation in
  the dev journal as before. It may be worth resolving that gitignore
  question properly at some point; it is not this refactor's call to make.
- **Group 8 is the only group with real risk.** Everything before it is
  additive, a pure move, or covered by tests written specifically to
  protect it. Moving a React state machine into a hook can change
  render timing and effect ordering in ways that compile cleanly and pass
  a careless test. The mitigation is that the group 2 test files must pass
  **unedited** after each of commits 33 to 35 — if a test needs changing
  to accommodate the extraction, the extraction changed behaviour, and the
  commit is wrong. Note it and stop rather than adjusting the test.
- **The 474 to ~120 line figure for `App.tsx` is an estimate**, not a
  target to hit by moving things arbitrarily. What matters is that the
  container's remaining job is to derive the viewer, choose the body and
  pass props.
- **This plan pays a debt named in plan 01.** Feature 1's refactor
  explicitly deferred "the duplication across the four mutating handlers"
  as behavioural rather than structural. The panel grew the same shape on
  the client side; group 8's mutation runner settles it here. The api-side
  version is still outstanding and is worth its own issue eventually.
- **Commit count is high (41) by design.** Most are small, mechanical and
  independently verifiable. The groups are ordered but internally
  flexible: within group 4, for instance, the component test commits can
  land in any order.

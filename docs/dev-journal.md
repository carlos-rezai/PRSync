# Dev Journal

Running log of notable decisions, dead ends, and context for future
sessions. Newest entries at the top.

---

## 2026-07-31 — User docs built and refactored (issues #26–#32, Feature 4)

Feature 4 shipped `docs/user-guide.md` and `docs/setup-guide.md`, gave
the README a front door that routes three readers, and put the whole set
under mechanical checks. Then
`docs/refactor-plans/04-user-docs-refactor.md` moved both halves to where
they belonged. No product code changed at any point: nothing under
`packages/*/src` outside `src/test/`, no card, no contract, no setting,
no behaviour. Final counts — docs **101 across 20**, bot **113 across
21** (down from 153/23), api 180, extension 191, green under `lint`,
`typecheck` and `test` after every commit.

**The documentation tests were living inside the Teams bot.**
`packages/bot/src/test/userDocs.test.ts` asserted against `README.md`,
both guides, the ubiquitous language and the extension's Marketplace
manifest. Exactly one of the files it read was in the package that owned
it, and that one was a manifest rather than source — so renaming a
heading in the **extension's** listing turned the **bot's** suite red.
They were put there because `deploymentDocs.test.ts` was already there
when Feature 4 needed a sibling. Build order, fossilised into structure,
for the **third** time: `App.test.tsx` (issue #14), `BotHost` (issue
#25), now this. All three had the same tell — a name or a location
describing _when_ something was written rather than _what it is about_ —
and in all three the tests had already split before the source did.

**A fourth workspace was cheaper than it looked.** `packages/docs` is
private, has no `main` and no `build` script, so
`npm run build --workspaces --if-present` skips it and no deploy target
can include it. `packages/*` already globbed it and `.husky/pre-commit`
already fanned out with `--workspaces --if-present`, so the gate picked
it up with no edit to any root script or hook. The move itself was
close to free because `packages/docs/src/test/` sits at the same depth as
`packages/bot/src/test/` — the four-level `repoRoot` and every
repo-relative constant in both files survived untouched. That depth
coincidence is why the riskiest-looking commit in the plan changed the
least, and why the move happened _before_ the decomposition rather than
after.

**The markdown fixture had become a library and nobody moved it.** 465
lines in `src/test/fixtures/` holding four engines — a fenced-block
walker, a section reader, a GitHub slug implementation with three
non-obvious rules, and a link resolver with its own `Repo` port — and
carrying the longest doc comments in the package. The proof was in its
consumer: of `userDocs.test.ts`'s 1,042 lines, roughly 500 were unit
tests **of the fixture**, driven against hand-built fakes with no
involvement of this repo's documents at all. It is now three layers of
real modules, and the functions that never made it out of the spec file
— `boldedTerms`, `withoutLinks`, `stageNumbers`, `settingTokens`, plus
`outsideFences` and `section`, which were inside the fixture and _also_
untested directly — have tests of their own for the first time.

**`readDoc` called `expect` from `vitest`, which is why it had to be a
fixture.** A fixture may import vitest; a module in `src/` may not. It
became `readDocument` and throws a labelled error instead, with the same
message, so the reader sees the same thing and nothing in
`packages/docs/src/` outside a co-located test imports vitest.

**`readSourceFiles` is duplicated, deliberately.** `layerPolicy.test.ts`
still needs a walker over the bot's own source and the moved deployment
test needs one too. Sharing means a workspace-to-workspace dependency,
which this repo has declined twice before — for `NotificationMessage`
and for `statusCodeOf`, both on the Feature 3 design log's reasoning.
Two copies of a 25-line walk, each beside its consumer and each with its
own test, and this one is test-only so it cannot reach a deploy at all.
Recorded in `docs/deployment.md`'s accepted costs so it reads as a
decision rather than an oversight.

**Two drift checks were generalised rather than re-pinned, and one of
them immediately found something.** The layer-table check read
`packages/bot` by name, so a fourth workspace's layers were guarded by
nobody — and `packages/docs` promptly became that workspace. The
build-status check named Feature 3, so the only drift it could see was
the one already fixed, while Feature 4 sat ✅ Complete in the README and
`- [ ]` in the project instructions. Pinning a drift check to the
instance that motivated it guarantees it catches that instance and
nothing else.

**Nothing had ever checked that a document is _reachable_.** The link
resolver proves every link that exists points somewhere real; it says
nothing about a document nobody links to. `checks/reachable/` follows
relative links from `README.md` transitively and reports every
`docs/**/*.md` no path arrives at. It is also the first check nobody
would have written while the only home for it was inside the Teams bot's
test directory — which is the second thing the workspace bought.

**The cross-reference check had only ever read three of the five
documents.** `docs/deployment.md` gained back-links in issue #30 and
`docs/ubiquitous-language.md` links out too; neither had ever had a link
of its own resolved. Both are now read as sources rather than merely as
targets.

**The gitignore trap recurred for the fifth time** (plans 01, 02, 03,
and twice in this one — the `packages/docs` layer table, and Feature 4's
`- [x]`). Both were applied on disk and are unversioned. The second is
now interesting rather than merely annoying: the build-status check
compares a versioned file against an unversioned one, so the two have to
move together in a commit that can only contain one of them. Filed as
its own issue rather than decided here, along with CI — outstanding
since refactor 03, and the thing that would have caught the trap in the
first place.

**Left undone on purpose.** Screenshots, ruled out in the design log and
still ruled out. In-panel help, still product code. Surfacing
**Unreachable** in the panel — the user guide's ladder still ends
honestly at the **Operator**, and changing that needs an API read path
and panel state, neither of which is modelled. A published Marketplace
listing page and real `privacyUrl` / `termsOfUseUrl` pages. And still
outstanding from plan 02: the API's four-handler duplication, which
belongs to `round-lifecycle` and wants its own issue.

## 2026-07-30 — Teams-notifications refactor (issue #25)

Executed the 17-commit plan in
`docs/refactor-plans/03-teams-notifications-refactor.md`. No behaviour
changed, no card changed, no API contract changed, and nothing outside
`packages/bot` was touched. The suite went from 103 tests across 18
files to **121 across 22**, green under `lint`, `typecheck` and `test`
after every commit.

**`BotHost` was four modules wearing one filename.** It held the bot's
activity routing, the four settings the adapter authenticates with, the
adapter factory, and a hand-written translation between the Azure
Functions HTTP types and Bot Framework's. The name was the tell — not a
term from the ubiquitous language, and not a description of any one
thing. The clearest evidence it had already split was that it had **two**
test files, one per concern that happened to get tested; the source never
followed. It is now `BotConfig`, `TeamsBot`, `BotAdapter` and
`MessagingEndpoint`, each in a folder named after it, and the split was a
pure move: every consumer already imported through the layer barrel, so
the composition root and both entry points changed not at all, and the
two existing test files changed one import line each and nothing else.

**Splitting it exposed exactly what was untested.** Two of the four
halves had no coverage at all: the HTTP translation — which copies every
inbound header one by one, and therefore carries the JWT the whole
anonymous `/api/messages` path depends on — and the adapter factory.
`TeamsSender` was the only module in the package with no test whatsoever.
Two of those three were untestable rather than untested, and for the same
reason.

**The structural port is the thing to reach for next time a vendor class
blocks a test.** `TeamsSender` took a concrete `CloudAdapter`; there was
no way to drive it without standing up Bot Framework. Narrowing the
parameter to an interface naming the ONE method actually called —
`ProactiveConversationOpener` — made it drivable through a recording fake
with no Bot Framework in the file, and `CloudAdapter` satisfies the
interface structurally, so the composition root did not change. Same move
for the translation layer's two parameters. This is not a new pattern:
`QueueProducer` in `packages/api` already does it to the Azure queue
client, which is why that producer is testable with no storage account.
The alternative was a cast — the fixtures already cast for
`InvocationContext` and `HttpRequest`, which genuinely have no honest
fake — and the port won because it makes the dependency one named method
instead of a whole class, and because two of the three ports are on
production signatures rather than buried in a fixture.

**The docs-drift trap was armed and had never been sprung.** Three tests
assert `.claude/CLAUDE.md` has not drifted from the source; that file is
gitignored, so on a fresh clone they did not skip, they FAILED. There is
no CI yet, which is the only reason nobody had hit it. They now skip when
the file is absent, with the reasoning recorded above the describe.
Verified both directions rather than assumed. Adding CI would have found
this; this plan defused the trap instead, and CI still wants its own
issue.

**The gitignore trap recurred for the third time** (plan 01 commit 20,
plan 02 commit 40, now plan 03 commit 16). The `teams/` layer table
update was applied on disk and is unversioned. Future sessions read the
on-disk file, so the convention IS documented, but force-adding
(`git add -f`) overrides a deliberate `.gitignore` choice and stays the
author's call. Commit 16 therefore has no git commit; 1–15 and 17 landed
as planned. **Worth deciding once rather than rediscovering a fourth
time.**

**Left undone on purpose.** The status-code reader still has a third copy
in the API's round repository — the two packages share no code and no
synchronous call by design, so extracting a shared module would
reintroduce the workspace-dependency deploy problem the design log ruled
out; it is a recorded accepted cost, not a defect. Still outstanding from
plan 02: the API's four-handler duplication, which belongs to
`round-lifecycle` and wants its own issue. And CI, per above.

## 2026-07-26 — Extension-panel refactor (issue #14)

Executed the 41-commit plan in
`docs/refactor-plans/02-extension-panel-refactor.md`. No panel
behaviour changed and no API contract changed; the suite went from 106
tests across 10 files to **191 across 29**, and `packages/extension`
is clean under `lint`, `typecheck` and `test`.

**`npm run lint` had never worked.** ESLint 9 and `@typescript-eslint`
were installed at the root but there was no `eslint.config.js`
anywhere, so both workspaces failed identically with "couldn't find an
eslint.config file". It went unnoticed because `.husky/pre-commit` ran
`lint-staged` (Prettier only), `typecheck` and `test` — never `lint`.
Fixed first, so every later commit was checked by it. The hook now
runs lint, scoped to `--workspace @prsync/extension`, because
`packages/api` reported 40 findings of its own — filed as **issue
#15** under `round-lifecycle` rather than dragged into an
extension-panel refactor. Drop the scope when #15 closes.

**Where the tests went.** `App.test.tsx` was 1,800 lines and 61 tests
under eleven describes named for the build slice that produced them.
It is now five behaviour-named files (load / mutations / polling /
errors / host) and there is deliberately no `App.test.tsx`. All eleven
components, `ApiClient`, `ApiError` and `AdoClient` gained co-located
tests; with those in place the container tests were THINNED (195 → 181
at that point) rather than left duplicating them. The rule applied: an
assertion belongs in a container test only if it checks which client
was called, with what, in what order, or which view resulted.

**The four generations of fake are gone.** `src/test/fixtures/` now
holds one complete typed fake per injected client. Each implements its
interface fully, so adding a method to `ApiClient` is a compile error
in one place; unstubbed methods reject by name instead of failing as
`x is not a function`. That deleted all nine type assertions in the
old test file, and 32 of the 33 lint findings with them.

**New `hooks/` layer.** `App.tsx` went from 474 lines to 144: the
state machine moved into `usePanelState`, and the four mutation
handlers collapsed onto one shared runner. The layer follows every
existing rule (folder per module, one barrel, cross-layer through
barrels). It was NOT in the design log's package layout; design logs
are immutable, so the deviation is recorded in the refactor plan and
in `.claude/CLAUDE.md` instead. The safety argument for the whole
group was that the five container test files had to pass **unedited**
after each of its commits — they did.

**Two things worth knowing for next time.**
`azure-devops-ui`'s `TextField` routes blur through `FocusWithin`,
which defers the callback behind a timer, so a blur assertion must
wait for it — including the negative ones, where "never committed" is
only provable once the deferred callback has had its chance. And
`azure-devops-extension-api/Git` ships as an AMD bundle with no loader
under Vitest, so `AdoClient`'s test has to stand in for it. That test
is also the one place `vi.mock` is used in the package: everywhere
else the DI seam exists to avoid it, but there the module boundary IS
what is under test.

**The `.claude/` gitignore trap recurred**, exactly as plan 01's
commit 20 hit it. Commit 40 updates `.claude/CLAUDE.md` — Feature 2
marked complete, the extension's seven layers documented, the ESLint
config recorded as the third leg of the linting setup the Tech Stack
section already claimed. `.gitignore:32` excludes `.claude`, so the
edit is applied on disk (future Claude sessions read it, so it IS
effective) but is not committed. Not force-added: that overrides a
deliberate `.gitignore` choice and is the author's call. The plan has
37 git commits rather than 41 — commit 2 (record lint baseline), 5
(file the api issue) and 40 (CLAUDE.md) change nothing in the repo by
design, and 36 landed as a test rather than a no-op.

**Left undone on purpose.** Wiring `mapApiError` into the load-failure
path: `ErrorState` shows one fixed message, and its comment used to
promise code-aware recovery it never received. The comment is
corrected; changing what a failed load SHOWS is a behaviour change and
wants its own issue. Also outstanding: the same four-handler
duplication on the api side, which plan 01 deferred and this refactor
only paid off on the client.

## 2026-07-25 — Extension panel built (issues #8–#13, Feature 2)

Feature 2 shipped as six sequential vertical slices, each its own
issue: read-only load paths (#8), the reviewer Done toggle (#9),
Ready for review (#10), label edit + cancel round (#11), polling and
the refresh banner (#12), theming and packaging (#13). Each ran the
full `tdd → build` loop.

Building it in slices was the right call and left the wrong shape
behind — the build order fossilised into the code, four generations of
test fake, and a 474-line container. That is what issue #14 above
cleaned up.

Decisions from the slices worth keeping in view:

- **Dependency injection, not module mocking.** The panel takes `sdk`
  / `api` / `ado` as props; tests pass fakes. The only module mocked
  anywhere is `azure-devops-extension-sdk`, in the `sdk/` seam's own
  tests, because that is the third-party system boundary.
- **The compose form REPLACES the read-only view** for the author on a
  terminal round, rather than sitting beside it.
- **Two ADO reads, and only one counts.** The load-time read gates the
  Ready button; the snapshot handed to `openRound` is read afresh at
  the click. A retry re-sends the API call alone, never the read, so
  it can never snapshot a reviewer list that moved in between.
- **Never live-patch.** Polling compares a client-computed
  `roundFingerprint` against the viewer's baseline and, on a
  divergence, raises a banner the viewer must click. The polled round
  itself is discarded.

## 2026-07-24 — Round-lifecycle folder-per-module refactor (issue #6)

Executed the 20-commit structural refactor in
`docs/refactor-plans/01-round-lifecycle-refactor.md`: every module in
`packages/api/src` now lives in its own folder with a co-located test,
and each of the four layers exposes a single barrel `index.ts` as its
public API. No behaviour changed; the full suite stayed green (125
tests) after every commit.

Discovered during commit 20: `.claude/` is gitignored
(`.gitignore:32`), so `.claude/CLAUDE.md` — where the plan says to
document the new convention — is untracked and cannot be committed
normally. The documentation edit was still applied on disk (future
Claude sessions read the on-disk file, so the convention IS
documented), but it lives outside version control unless force-added
(`git add -f`). Left for the author to decide, since force-adding
overrides a deliberate `.gitignore` choice. Commit 20 therefore has no
git commit of its own; commits 1–19 landed as planned.

## 2026-07-23 — Project scaffolded

Repo structure set up as an npm-workspaces monorepo with three
packages (`extension`, `api`, `bot`), following the same
`docs/`-as-paper-trail convention as Horizon. Initial grill-me session
completed covering the full round/phase/reviewer data model and the
v1 scope (ADO extension panel + Teams DM via incoming webhook, no bot
yet). See docs/ubiquitous-language.md for terms established.

`packages/bot` is a placeholder only — deferred to v2, see CLAUDE.md
Build Status.

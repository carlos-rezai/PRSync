# Dev Journal

Running log of notable decisions, dead ends, and context for future
sessions. Newest entries at the top.

---

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

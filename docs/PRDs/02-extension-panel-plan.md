# Plan: Extension Panel

> Source PRD: https://github.com/carlos-rezai/PRSync/issues/7

Feature 2 of PRSync: the PR-page panel that gives Feature 1's
round-lifecycle API a user-facing surface. A React + `azure-devops-ui`
panel contributed as an `ms.vss-web.tab` on the ADO pull-request page,
running in the ADO-hosted iframe. It renders one round — the current
one — derives the viewer's role locally for presentation only, and maps
the five Feature 1 endpoints to native-looking controls, while every
mutation is re-authorized server-side.

Terminology follows `docs/ubiquitous-language.md` exactly — `round`,
`phase`, `done`, `quorum`, `PR key`, `adoId`. Layout follows
`docs/handoff/panel-layout-spec.md` (amended in design log Q6 to add the
Cancel round control). Full rationale in
`docs/design-logs/02-extension-panel.md`.

Each phase is a thin vertical slice cutting through every layer
(`sdk/` → `api/` → `ado/` → `lib/` → `components/` → `App/`) with
co-located Vitest tests, built TDD (RED → build). The Vite/jsdom
config, the `sdk` seam, and the foundational `lib/` helpers are folded
into the first slice that exercises them rather than shipped as
un-demoable horizontal layers.

## Architectural decisions

Durable decisions that apply across all phases:

- **Contribution**: an `ms.vss-web.tab` (`prsync-pr-panel`) on
  `ms.vss-code-web.pr-detail-page` — already declared in
  `packages/extension/vss-extension.json`. Built with Vite
  (`base: './'`, root `index.html`, output to `dist/`), packaged into a
  `.vsix` via `tfx`. The panel runs inside the ADO-hosted iframe and is
  a near-pure function of a single `getCurrentRound` response.
- **API routes consumed** (Feature 1, all require the caller's ADO
  bearer token via `SDK.getAccessToken()`):
  - `GET   /api/prs/{prKey}/rounds/current` — current round → `200` /
    `204`
  - `POST  /api/prs/{prKey}/rounds` — open next round → `201`; `409`
    already open · `422` insufficient reviewers
  - `PATCH /api/prs/{prKey}/rounds/{n}/done` — toggle own Done → `200`;
    `403` not a reviewer · `409` not open
  - `PATCH /api/prs/{prKey}/rounds/{n}` — edit label (author) → `200`;
    `403` not author · `409` not open
  - `POST  /api/prs/{prKey}/rounds/{n}/cancel` — cancel (author) →
    `200`; `403` not author · `409` not open
- **PR key**: a client copy of `buildPrKey` reproducing the API's
  `{projectId}:{repositoryId}:{pullRequestId}` (`{guid}:{guid}:{int}`)
  format exactly, built from the PR-tab contribution context. It is the
  contract both sides share.
- **Three data sources, one role each**:
  - Reviewer rows render purely from `round.reviewers` (PRSync API) —
    the frozen open-time snapshot. ADO's live reviewer list is **never**
    rendered on an open round.
  - The viewer's identity for role selection comes from
    `SDK.getUser().id` (the ADO GUID = `adoId`), used _only_ to choose
    the view — never trusted for authorization.
  - ADO's live reviewer list (plus PR title and URL) is read from ADO's
    own PR REST API at exactly one moment — the "Ready for review"
    click.
- **Roles** (presentation only): **Author** (`viewerAdoId ===
round.authorAdoId`, or PR `createdBy` when no round), **Reviewer**
  (matches a `round.reviewers[i].adoId`), **Bystander** (neither →
  read-only).
- **Internal architecture** (mirrors `packages/api`): folder-per-module,
  one barrel per layer, co-located tests, and the same two import rules
  — cross-layer imports resolve through the target barrel
  (`../lib`, `../api`, `../ado`, `../sdk`); within-layer sibling imports
  use direct file paths. Layers: `App/` (container: load, poll,
  mutations, wiring), `sdk/` (the _only_ module importing
  `azure-devops-extension-sdk`), `api/` (PRSync API client), `ado/` (ADO
  REST via `azure-devops-extension-api` `GitClient`), `lib/` (pure,
  every module tested: `buildPrKey`, `roundFingerprint`, `deriveRole`,
  `deriveDefaultLabel`, `mapApiError`), `components/` (pure, prop-driven
  `azure-devops-ui` components).
- **Testing seam**: dependency-inject the `sdk` / `api` / `ado` clients
  into the `App` container (fakes in tests) rather than `vi.mock`-ing
  the SDK. Vitest + `jsdom` config and setup (none exists yet), with
  `@testing-library/react` for components. Tests assert external,
  observable behavior — rendered output and the client calls a user
  action produces — never internal component structure. Every `lib/`
  module has a test (a project code rule).
- **Drift model** (no etag/`updatedAt` exists on `Round`): a client
  `roundFingerprint` over `roundNumber` + `status` + `phase` + `label` +
  each reviewer's `done`, compared against a **baseline**. The viewer's
  own mutations reset the baseline; a poll divergence means someone else
  changed state → a **refresh banner** (`MessageCard`, info) the viewer
  must click — never a silent live-patch. This is deliberately
  client-side to avoid any change to Feature 1's API or schema.
- **Error mapping**: a pure, tested `mapApiError(status, code)` →
  `{ message, recovery }`. `409 ROUND_ALREADY_OPEN` / `ROUND_NOT_OPEN`
  and `403 NOT_AUTHOR` / `NOT_A_REVIEWER` → "state drifted": re-fetch +
  banner. `422 INSUFFICIENT_REVIEWERS` → inline validation. `503
CONCURRENCY_EXHAUSTED` → auto-retry once, then "try again". `401` →
  "session expired, refresh".
- **New dependency**: add `azure-devops-extension-api` (currently absent
  from `packages/extension/package.json`) for its typed `GitClient`
  (`getPullRequestById`) — a hand-rolled `fetch` is rejected.
- **Deploy prerequisite**: the Function App must allow CORS from the ADO
  org origin so the iframe's cross-origin calls aren't blocked in
  production (documented in Phase 6).

---

## Phase 1: Boot + read-only render

**User stories**: 1, 2, 3, 4, 24, 25, 37, 38, 39, 40, 41

### What to build

The first working end-to-end path: the PRSync tab appears on the ADO PR
page, boots inside the iframe, reads the current round in one request,
and renders it read-only in native `azure-devops-ui`. On mount the
`App` container resolves the PR key from the contribution context and
calls `getCurrentRound`. A `200` derives the whole view from the round
(author / reviewer / bystander) and renders the header, editable-looking
round label (display mode), phase, reviewer rows (`Persona` + a
read-only `Checkbox` reflecting each `done`), and the derived status
pill ("2 of 3 reviewed" / "All reviewed") — no ADO REST call. A `204`
(no round) does a single ADO `createdBy` read to decide author (→ an
empty compose placeholder) vs. bystander (→ a `ZeroData` "No round
yet"). A round with no reviewers degrades to a `ZeroData` empty state; a
failed load shows an error state; the initial fetch shows a `Spinner`.
No control mutates anything yet.

This slice necessarily brings up the foundations every later phase
reuses: the Vite (`base: './'`) + root `index.html` boot, the Vitest +
`jsdom` config and setup, the `sdk/` seam (getUser, prKeyParts,
getAccessToken), the `api/` client's `getCurrentRound`, the DI wiring of
`sdk`/`api`/`ado` into `App`, and the pure `lib/` helpers this view
needs (`buildPrKey`, `deriveRole`, `deriveDefaultLabel` for the display
label), plus the prop-driven read-only `components/`.

### Acceptance criteria

- [ ] The `prsync-pr-panel` tab renders inside the ADO PR page and
      resolves the PR key from the contribution context in the exact
      `{guid}:{guid}:{int}` format `buildPrKey` produces.
- [ ] On mount the panel shows a `Spinner`, then renders the current
      round from a single `getCurrentRound` (`200`) with no ADO REST
      call.
- [ ] The viewer's role (Author / Reviewer / Bystander) is derived from
      the round via `deriveRole` and drives which read-only view shows;
      a Bystander sees a fully read-only panel.
- [ ] Reviewer rows render purely from `round.reviewers` (the frozen
      snapshot) as `Persona` + read-only `Checkbox`; the status pill is
      derived ("N of M reviewed" while open, "All reviewed" when
      closed).
- [ ] `204` (no round) triggers one ADO `createdBy` read: author → a
      compose placeholder, non-author → `ZeroData` "No round yet".
- [ ] A round with no reviewers renders a `ZeroData` empty state; a
      failed initial load renders an error state.
- [ ] The panel package mirrors the API's folder-per-module +
      per-layer-barrel structure with the two import rules; `sdk`/`api`/
      `ado` are dependency-injected into `App`.
- [ ] Vitest + `jsdom` is configured; every `lib/` helper introduced
      (`buildPrKey`, `deriveRole`, `deriveDefaultLabel`) is unit-tested;
      the `App` load paths (`200` role derivation, `204`
      author→compose vs. bystander→ZeroData, error) are tested with
      injected fakes.

---

## Phase 2: Done toggle

**User stories**: 18, 19, 20, 21, 22, 23, 33

### What to build

A reviewer signals Done on the open round from their own row. The
own-row `Checkbox` becomes interactive (only for the reviewer, only
while `status === "open"`); clicking it flips optimistically, calls
`toggleDone` (`PATCH …/done`, carrying no reviewer id — the API targets
the authenticated caller), and then **replaces** panel state with the
returned `Round` — authoritative, so an auto-close when the toggle meets
quorum is surfaced immediately and the whole list freezes. On error the
toggle reverts with an inline message. Every other reviewer's row stays
read-only, and once the round is `closed` all checkboxes are frozen for
everyone. A `409`/`403` the UI shouldn't normally allow (round not open,
not a reviewer) maps via `mapApiError` to a "state drifted" re-fetch so
a drifted client self-heals.

### Acceptance criteria

- [ ] The own-row `Checkbox` is interactive only for the Reviewer and
      only while `status === "open"`; every other row is read-only.
- [ ] Clicking Done flips optimistically, calls `toggleDone`, then
      replaces panel state with the returned `Round`; a returned
      `closed` round surfaces the auto-close and freezes the list.
- [ ] A failed `toggleDone` reverts the optimistic flip and shows an
      inline recovery message.
- [ ] Once the round is `closed`, all Done checkboxes are frozen for
      author, reviewer, and bystander alike.
- [ ] `403 NOT_A_REVIEWER` / `409 ROUND_NOT_OPEN` from `toggleDone` map
      (via `mapApiError`) to a re-fetch that self-heals the client to
      the true state.
- [ ] `App` tests cover the optimistic-then-reconcile path, the
      revert-on-error path, the freeze-when-closed rule, and the
      drift-heal on `409`/`403`, all through injected fakes.

---

## Phase 3: Ready for review

**User stories**: 9, 10, 11, 12, 13, 14, 36

### What to build

The author opens the next round with one click. When no round is open
(round `closed`/`cancelled`, or the `204` compose form), the author sees
a phase toggle ("Use Case Review" / "Implementation Review", defaulting
to the previous round's phase or `spec`) and a primary "Ready for
review" button. Clicking it reads ADO's own PR REST API at that exact
moment via the `ado/` `GitClient` (`getPullRequestById`) — a fresh
snapshot of reviewers, title, and URL — then calls `openRound`
(`POST …/rounds`). The `IdentityRefWithVote` reviewers map to Feature
1's incoming-reviewer shape. The label field is pre-filled from the
canonical default; if untouched the `label` is **omitted** so the API
generates it (no UI/DB divergence). "Ready for review" is enabled only
when no round is open, and a light client pre-check disables it with a
hint when the fresh snapshot has zero eligible individual reviewers
besides the author; the API's `422` is the server-owned backstop.

### Acceptance criteria

- [ ] The phase toggle and "Ready for review" button appear only for the
      Author and only when no round is open; the toggle defaults to the
      previous round's phase, or `spec` when there is none.
- [ ] Clicking "Ready for review" reads ADO's live reviewers + title +
      url via the injected `ado` `GitClient` at that moment, then calls
      `openRound` with the snapshot.
- [ ] The label default is derived from round number + phase; when the
      author leaves it untouched, `label` is omitted from the
      `openRound` call; when edited, the exact text is sent.
- [ ] "Ready for review" is disabled with a hint when the fresh snapshot
      has zero eligible individual reviewers besides the author.
- [ ] A `422 INSUFFICIENT_REVIEWERS` from `openRound` maps to an inline
      validation message (the server-owned backstop).
- [ ] `App` tests assert the read-ADO-then-`openRound` sequence, the
      label-omitted-when-untouched rule, the phase default, and the
      pre-validation + `422` mapping via injected fakes.

---

## Phase 4: Label edit + Cancel round

**User stories**: 5, 6, 7, 8, 15, 16, 17

### What to build

The author's two management actions on an open round. The round label
becomes an inline-editable `TextField` (author only, while `open`);
editing and committing calls `editLabel` (`PATCH …/rounds/{n}`) with the
exact text. A "Cancel round" button (secondary/danger) is visible only
to the author and only while the round is `open`; clicking it opens a
"Cancel round?" confirmation `Dialog`, and confirming calls
`cancelRound` (`POST …/rounds/{n}/cancel`) — a silent abandonment that
fires no Teams notification (unlike a real close). This adds the control
that makes the `cancelRound` endpoint reachable and gives the author a
recovery path for a mistaken or quorum-unreachable round. With cancel in
place, the full open → {closed | cancelled} → open (N+1) cycle is
demonstrable from the panel.

### Acceptance criteria

- [ ] The round label is an inline-editable `TextField` for the Author
      while `open`, and display-only otherwise; committing an edit calls
      `editLabel` with the exact text.
- [ ] The "Cancel round" button is visible only to the Author and only
      while the round is `open`.
- [ ] Clicking "Cancel round" opens a confirmation `Dialog`; confirming
      calls `cancelRound`, and the panel reflects the resulting
      `cancelled` state.
- [ ] Cancelling fires no Teams notification (verified via the API
      contract — cancel is silent).
- [ ] After a cancel, the author can open the next round from the
      panel (round N+1).
- [ ] `App`/component tests cover the inline label-edit commit, the
      Cancel confirmation flow (open dialog → confirm → `cancelRound`),
      and that both controls are gated to author + open.

---

## Phase 5: Polling + refresh banner

**User stories**: 26, 27, 28, 29, 30, 31, 32, 34, 35

### What to build

The panel keeps up with a live team activity without ever silently
live-patching. A 20-second poll re-runs `getCurrentRound` and computes a
`roundFingerprint`, comparing it to the baseline. A divergence caused by
_someone else's_ change (another reviewer's Done, an author cancel)
raises a `MessageCard` refresh banner the viewer must click to re-fetch,
re-render, and reset the baseline. The viewer's own mutations reset the
baseline so they never self-trigger the banner. Polling pauses while a
mutation of the viewer's is in flight (so a poll can't clobber an
optimistic update) and while the tab is hidden (Page Visibility API).
This slice also completes the error surface: the full `mapApiError`
table gives clear, recovery-oriented messages — `401` "session expired,
refresh"; `503 CONCURRENCY_EXHAUSTED` auto-retried once before a "try
again"; drift-class `409`/`403` re-fetch + banner; validation inline.

### Acceptance criteria

- [ ] `getCurrentRound` polls every ~20s; polling pauses while a
      viewer mutation is in flight and while the tab is hidden.
- [ ] `roundFingerprint` is stable for equal rounds and changes when any
      of `roundNumber`, `status`, `phase`, `label`, or any reviewer's
      `done` changes; it is unit-tested against all those cases.
- [ ] A poll fingerprint divergence from _someone else's_ change raises
      the refresh `MessageCard`; the viewer's own mutations reset the
      baseline and never raise it.
- [ ] Clicking the banner re-fetches, re-renders, and resets the
      baseline — the only path that updates a drifted panel.
- [ ] `mapApiError` maps every `{status, code}` pair to the intended
      message + recovery (drift-heal `409`/`403`, `422` inline, `503`
      single-retry directive, `401` session-expired); it is exhaustively
      unit-tested.
- [ ] A transient `503 CONCURRENCY_EXHAUSTED` is auto-retried once
      before surfacing "try again"; a `401` surfaces "session expired,
      refresh".

---

## Phase 6: Theming + packaging

**User stories**: 42, 43, 44

### What to build

The panel is made to sit naturally in the host page and ship as an
installable extension. It respects ADO's light/dark theme (the theme
cascade from the host) and resizes to its content via `SDK.resize`. The
build is finalized: `vite.config.ts` (`base: './'`), root `index.html`,
the `assets/icon-ado-128.png` wired into `vss-extension.json` (replacing
the `icon.png` placeholder), and the `tfx` package step confirmed to
produce a clean `.vsix`. The Function App CORS requirement (allow the
ADO org origin) is documented as a deploy prerequisite so the panel's
cross-origin calls aren't blocked in production.

### Acceptance criteria

- [ ] The panel respects ADO's light and dark theme and resizes to its
      content via `SDK.resize`.
- [ ] `vite.config.ts` uses `base: './'` with a root `index.html`, and
      `vss-extension.json` points its icon at the real
      `assets/icon-ado-128.png` (no placeholder).
- [ ] `npm run package` (`tfx`) produces a clean `.vsix` from the built
      `dist/`.
- [ ] The Function App CORS requirement (ADO org origin) is documented
      as a deploy prerequisite.

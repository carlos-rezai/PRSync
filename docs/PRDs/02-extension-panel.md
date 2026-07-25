## Problem Statement

Feature 1 shipped the entire round-lifecycle API — open, toggle-done,
close-on-quorum, cancel, edit-label — but it has no user-facing surface.
A PRSync user living inside an Azure DevOps pull request today has no
way to see whether a round is open, who has clicked Done, whether the
quorum is met, or to fire "Ready for review" without hand-crafting HTTP
calls. The author can't open or cancel a round, reviewers can't signal
Done, and nobody can see round status without leaving the PR page.

Worse, once a panel _is_ open in the browser, review is a live team
activity: another reviewer clicks Done, or the author cancels, and the
panel a person is staring at silently goes stale. Feature 1's `Round`
carries no `updatedAt` or etag, so there is no server-provided signal to
detect that staleness — yet the product principle is explicit that the
panel must never silently live-patch state under someone's cursor.

The author also needs the reviewer list to be an honest open-time
snapshot (Feature 1's frozen model), which means the panel must resist
the temptation to render ADO's live reviewer list on an already-open
round — and must read ADO's live list at exactly one moment: the
instant "Ready for review" is clicked.

## Solution

A React + `azure-devops-ui` panel contributed as an `ms.vss-web.tab` on
the ADO pull-request page (`ms.vss-code-web.pr-detail-page`), running in
the ADO-hosted iframe. It reads round state from the PRSync API and
renders one round — the current one — deriving the viewer's role
(Author, Reviewer, or Bystander) locally for presentation only, while
every mutation is re-authorized server-side against the caller's ADO
bearer token.

The panel maps the five Feature 1 endpoints to native-looking controls:
an editable round label, a phase toggle (compose-time), a reviewer list
with per-row Done checkboxes, a "Ready for review" button, a "Cancel
round" button with a confirmation dialog, and a derived status pill.
"Ready for review" is the single moment the panel reads ADO's own PR
REST API — a fresh snapshot of reviewers, title, and URL — before
calling `openRound`.

Because the `Round` has no etag, the panel computes a client-side
**fingerprint** of the round's salient lifecycle fields against a
**baseline**. A 20-second poll compares fingerprints; a divergence
caused by someone else's change raises a **refresh banner** the viewer
must click — never a silent live-patch. The viewer's own mutations
reset the baseline so they never self-trigger the banner.

Internally the panel mirrors `packages/api`'s discipline exactly:
folder-per-module, one barrel per layer, co-located tests, and the same
two import rules — so the monorepo reads as one codebase.

## User Stories

1. As a **viewer**, I want the PRSync panel to appear as a tab on the
   ADO pull-request page, so that I never leave the PR to coordinate a
   review round.
2. As a **viewer**, I want the panel to look native inside ADO (built
   from `azure-devops-ui`), so that it feels like part of the product,
   not a bolted-on widget.
3. As a **viewer**, I want the panel to show a spinner while the initial
   round fetch resolves, so that I know it is loading rather than broken.
4. As a **viewer**, I want the panel to derive my role (Author,
   Reviewer, or Bystander) from the current round, so that I only see
   the controls I'm allowed to use.
5. As an **author**, I want to see an editable round label while my
   round is open, so that I can name the round meaningfully (e.g.
   "Round 2 — Implementation Review").
6. As an **author**, I want the round label to be auto-filled from the
   round number and phase, so that I don't have to name every round by
   hand.
7. As an **author**, I want to leave the label untouched and have the
   API generate the canonical label, so that the panel and database
   never diverge on wording.
8. As an **author**, I want to edit the label and have my exact text
   sent, so that a deliberate rename is honored.
9. As an **author** with no open round, I want a phase toggle ("Use
   Case Review" / "Implementation Review"), so that I can choose what
   the next round reviews before opening it.
10. As an **author**, I want the phase toggle to default to the previous
    round's phase (or `spec` when there is none), so that the common
    case needs no interaction.
11. As an **author**, I want a "Ready for review" button that opens the
    next round, so that I can start a review cycle with one click.
12. As an **author**, I want "Ready for review" to read ADO's live
    reviewer list at that exact moment and snapshot it, so that the
    round's reviewer list is an honest picture of the PR when I opened
    it.
13. As an **author**, I want "Ready for review" enabled only when no
    round is open (round closed or none yet), so that I can't
    accidentally open a second concurrent round.
14. As an **author**, I want "Ready for review" disabled with a hint
    when the fresh snapshot has zero eligible individual reviewers
    (besides me), so that I understand why I can't open a round yet.
15. As an **author**, I want a "Cancel round" button visible only while
    a round is open, so that I can abandon a round opened by mistake or
    one whose quorum became unreachable.
16. As an **author**, I want "Cancel round" to require a confirmation
    dialog, so that a silent, notification-free abandonment isn't a
    single misclick.
17. As an **author**, I want cancelling a round to fire no Teams
    notification, so that a silent abandonment stays silent (unlike a
    real close).
18. As a **reviewer**, I want a Done checkbox on my own row, so that I
    can signal I've finished my pass on this round.
19. As a **reviewer**, I want my Done checkbox to update optimistically,
    so that the panel feels responsive when I click it.
20. As a **reviewer**, I want the panel to reconcile against the round
    the API returns after I toggle Done, so that I immediately see an
    auto-close when my Done meets the quorum.
21. As a **reviewer**, I want my Done toggle to revert with an inline
    message if the PATCH fails, so that I'm never misled into thinking I
    signaled Done when I didn't.
22. As a **reviewer**, I want to toggle only my own row and see every
    other reviewer's row as read-only, so that I can't sign off on
    someone else's behalf.
23. As a **reviewer** or **author**, I want all Done checkboxes frozen
    once the round is closed, so that a closed round's record can't be
    edited after the fact.
24. As a **bystander** (neither author nor tracked reviewer), I want a
    fully read-only panel, so that I can observe round status without
    being able to change anything.
25. As a **viewer**, I want a status pill summarizing progress (e.g.
    "2 of 3 reviewed" while open, "All reviewed" when closed), so that I
    can grasp round state at a glance.
26. As a **viewer**, I want the panel to poll round state every ~20
    seconds, so that I learn about others' changes without manually
    refreshing.
27. As a **viewer**, I want polling to pause while a mutation of mine is
    in flight, so that a poll can't clobber my own optimistic update.
28. As a **viewer**, I want polling to pause while the tab is hidden, so
    that a backgrounded panel doesn't waste requests.
29. As a **viewer**, I want a refresh banner to appear only when polling
    detects that _someone else_ changed the round, so that I'm alerted
    to drift rather than surprised by a silent live-patch.
30. As a **viewer**, I want my own mutations to reset the drift baseline,
    so that my own changes never raise the refresh banner at me.
31. As a **viewer**, I want to click the refresh banner to re-fetch and
    re-render, so that I control exactly when the stale panel updates.
32. As a **viewer**, I want clear, recovery-oriented messages for API
    errors (session expired, state drifted, validation failed,
    transient concurrency), so that I know what to do next rather than
    seeing a raw status code.
33. As a **viewer**, I want a `409`/`403` that the UI shouldn't normally
    allow (round already open, not-a-reviewer, etc.) to trigger a
    re-fetch and banner, so that a drifted client silently self-heals to
    the true state.
34. As a **viewer** hitting a transient `503 CONCURRENCY_EXHAUSTED`, I
    want one automatic retry before a "try again" message, so that a
    momentary write contention doesn't surface as a hard error.
35. As a **viewer** whose token expired (`401`), I want a "session
    expired, refresh" message, so that I understand the fix is to reload.
36. As an **author** opening a round on a PR with no eligible reviewers,
    I want the `422` from the API mapped to an inline validation
    message, so that the server's gating rule is the backstop even if my
    client-side pre-check misses.
37. As a **viewer** on a PR that has never had a round, I want the panel
    to decide my view from ADO's `createdBy`: a compose form if I'm the
    author, or a "No round yet" empty state if I'm not, so that the
    empty case is still role-aware.
38. As a **viewer** on a PR that somehow has a round but no reviewers, I
    want a `ZeroData` empty state, so that the panel degrades gracefully
    rather than rendering an empty list.
39. As a **maintainer**, I want the panel package to mirror the API's
    folder-per-module + per-layer-barrel structure, so that the monorepo
    stays internally consistent for portfolio and team use.
40. As a **maintainer**, I want the SDK, PRSync API, and ADO REST
    clients dependency-injected into the App container, so that the
    whole panel is testable with fakes and no live ADO host.
41. As a **maintainer**, I want every `lib/` helper unit-tested, so that
    the pure drift/role/label/error logic is verified in isolation.
42. As a **maintainer**, I want the panel to build with Vite
    (`base: './'`) and package cleanly via `tfx`, with the ADO icon
    wired into `vss-extension.json`, so that the extension is
    installable.
43. As a **deployer**, I want the Function App CORS requirement
    documented as a deploy prerequisite, so that the panel's cross-origin
    calls from the ADO iframe aren't blocked in production.
44. As a **viewer**, I want the panel to respect ADO's light/dark theme
    and resize to its content, so that it sits naturally in the host
    page.

## Implementation Decisions

**Data sourcing (three distinct sources, one role each):**

- Reviewer rows render purely from `round.reviewers` (PRSync API) — the
  frozen open-time snapshot. ADO's live reviewer list is never rendered
  on an open round.
- The viewer's identity for role selection comes from `SDK.getUser().id`
  (the ADO identity GUID = `adoId`), used _only_ to choose the view.
  Authorization is never client-trusted: every mutation carries
  `SDK.getAccessToken()` and the API re-authorizes by `adoId`.
- ADO's live reviewer list (plus PR title and URL) is read from ADO's
  own PR REST API at exactly one moment — the "Ready for review" click.

**PR key construction:** Built from the PR-tab contribution context
(`projectId`, `repositoryId` GUIDs, `pullRequestId` int) using a client
copy of `buildPrKey` that reproduces the `{guid}:{guid}:{int}` format of
`packages/api/src/lib/prKey` exactly.

**Load sequence:** On mount → `getCurrentRound`.

- `200` (round exists): derive the whole view from the round
  (author = `authorAdoId`; reviewer = a match in `round.reviewers`;
  otherwise bystander). No ADO REST call.
- `204` (no round): a single ADO REST read of `createdBy` decides author
  (→ compose form) vs. bystander (→ ZeroData "No round yet").

**Roles (presentation only, never trusted for authorization):**

- **Author** — `viewerAdoId === round.authorAdoId` (or PR `createdBy`
  when no round): edit label (open), toggle phase (compose), Ready for
  review, Cancel round.
- **Reviewer** — `viewerAdoId` matches a `round.reviewers[i].adoId`:
  toggle own Done, only while `status === "open"`.
- **Bystander** — neither: read-only.

**Endpoint → control mapping (verified against Feature 1 routes):**

| Control            | Endpoint                                      | Gating                       |
| ------------------ | --------------------------------------------- | ---------------------------- |
| Round label (edit) | `PATCH /api/prs/{prKey}/rounds/{n}`           | author, `status === "open"`  |
| Phase toggle       | compose-only → `POST /api/prs/{prKey}/rounds` | author, no open round        |
| Reviewer Done      | `PATCH /api/prs/{prKey}/rounds/{n}/done`      | own row, `status === "open"` |
| Ready for review   | `POST /api/prs/{prKey}/rounds`                | author, no open round        |
| Cancel round       | `POST /api/prs/{prKey}/rounds/{n}/cancel`     | author, `status === "open"`  |
| Refresh banner     | re-`GET /api/prs/{prKey}/rounds/current`      | on fingerprint drift         |

**Compose defaults:** Label = `Round {n} — {Spec|Implementation} Review`
where `n = last.roundNumber + 1` (or `1`). Shown as the field value; if
untouched, `label` is **omitted** from `openRound` so the API generates
canonically (no UI/DB divergence); if edited, the exact text is sent.
Default phase = the previous round's phase if one exists, else `spec`.

**Done toggle:** Optimistic — flip immediately, `PATCH`, then replace
panel state with the returned `Round` (authoritative; surfaces auto-close
when quorum is met and freezes the list). On error, revert + inline
message.

**Cancel round:** Author-only, visible only while `open`; rendered as a
secondary/danger `Button` with a "Cancel round?" confirmation `Dialog`.
This amends `docs/handoff/panel-layout-spec.md`, which originally omitted
it (design log Q6) — without it the `cancelRound` endpoint is unreachable
from the UI and the author has no recovery path.

**Drift detection (no etag exists on `Round`):** Compute a client
**fingerprint** over `roundNumber` + `status` + `phase` + `label` + each
reviewer's `done`, compared against a **baseline**. Own mutations reset
the baseline; a poll divergence means someone else changed state → show
the refresh banner (`MessageCard`, info severity), never a silent patch.
Clicking the banner re-fetches, re-renders, and resets the baseline.

**Polling:** `getCurrentRound` every 20s (within the spec's 15–30s
window), paused while a mutation is in flight and while the tab is hidden
(Page Visibility API).

**Error mapping** — a pure, tested `mapApiError(status, code)` →
`{ message, recovery }`. Confirmed against Feature 1's service error
codes:

- `409 ROUND_ALREADY_OPEN` / `409 ROUND_NOT_OPEN`, and `403 NOT_AUTHOR` /
  `403 NOT_A_REVIEWER` → "state drifted": re-fetch + banner (the UI
  should rarely allow these).
- `422 INSUFFICIENT_REVIEWERS` → inline validation (e.g. "needs an
  eligible reviewer in ADO").
- `503 CONCURRENCY_EXHAUSTED` → auto-retry once, then "try again".
- `401` → "session expired, refresh".

**openRound pre-validation:** A light client check disables "Ready for
review" with a hint when the fresh snapshot contains zero non-container
individuals besides the author. The `422` mapping is the server-owned
backstop — gating logic stays in the service.

**ADO REST access:** Add `azure-devops-extension-api` (currently absent
from `packages/extension/package.json`) and use its typed `GitClient`
(`getPullRequestById`), whose `IdentityRefWithVote` reviewers map cleanly
to Feature 1's `IncomingReviewer`. A hand-rolled `fetch` is rejected — it
would force us to own ADO's response shape and URL construction.

**Internal architecture (mirrors `packages/api`):** folder-per-module,
one barrel per layer, co-located tests. Cross-layer imports resolve
through barrels (`../lib`, `../api`, `../ado`, `../sdk`); within-layer
sibling imports use direct file paths. Layers:

- `App/` — container: load, poll, mutations, wiring.
- `sdk/` — the _only_ module importing `azure-devops-extension-sdk`
  (getUser, getAccessToken, prKeyParts, resize, theme).
- `api/` — PRSync API client (`getCurrentRound`, `openRound`,
  `toggleDone`, `editLabel`, `cancelRound`).
- `ado/` — ADO REST via `azure-devops-extension-api` GitClient
  (reviewers / createdBy / title / url).
- `lib/` — pure, every module tested: `buildPrKey`, `roundFingerprint`,
  `deriveRole`, `deriveDefaultLabel`, `mapApiError`.
- `components/` — pure, prop-driven `azure-devops-ui` components:
  `PanelHeader`, `RoundLabel`, `PhaseToggle`, `ReviewerList`,
  `StatusPill`, `ReadyButton`, `CancelButton`, `RefreshBanner`.

**Testing seam:** Dependency-inject the `sdk` / `api` / `ado` clients
into the `App` container (fakes in tests) rather than `vi.mock`-ing the
SDK. Add a Vitest `jsdom` config + setup (none exists yet).

**Packaging:** `vite.config.ts` with `base: './'`; root `index.html`;
wire `assets/icon-ado-128.png` into `vss-extension.json` (currently an
`icon.png` placeholder); confirm the `tfx` package step. The tab
contribution on `ms.vss-code-web.pr-detail-page` already exists in the
manifest.

**Build order (thin vertical slices):**

1. Boot + read-only render (Vite/jsdom config, `sdk/`, `api/`
   `getCurrentRound` only, header + reviewer rows + status pill,
   loading/ZeroData/error states, no mutations).
2. Done toggle (`toggleDone`, own-row checkbox, optimistic + reconcile,
   frozen-when-closed, `409`/`403` mapping).
3. Ready for review (`ado/` GitClient read at click, `openRound`,
   compose form, pre-validation + `422`/`409` mapping).
4. Label edit + Cancel round (`editLabel` inline edit; `cancelRound`
   with confirmation Dialog).
5. Polling + refresh banner (fingerprint baseline, 20s poll,
   visibility/mutation pause, `MessageCard`).
6. Theming + packaging (ADO theme cascade, `SDK.resize`, icon wiring,
   `tfx` package, document Function App CORS).

## Testing Decisions

**What makes a good test here:** assert external, observable behavior —
what the viewer sees and what the injected clients are called with — not
internal component structure or private state. A `lib` test asserts the
function's output for given inputs; an `App`/component test asserts
rendered output and the client calls a user action produces, using
injected fakes.

**Prior art:** `packages/api`'s co-located `*.test.ts` suite (125
tests) — pure `lib` unit tests and handler tests that inject fakes at the
seam (`IdentityResolver`, service, storage). The panel reproduces this
discipline on the UI side with `@testing-library/react` for components
and injected `sdk`/`api`/`ado` fakes for the `App` container.

**Modules to test:**

- `lib/buildPrKey` — produces the exact `{guid}:{guid}:{int}` format;
  must match the API's `prKey` format (the contract both sides share).
- `lib/roundFingerprint` — stable for equal rounds; changes when any of
  `roundNumber`, `status`, `phase`, `label`, or any reviewer's `done`
  changes; unaffected by irrelevant fields.
- `lib/deriveRole` — author / reviewer / bystander for the round case
  and the no-round (`createdBy`) case.
- `lib/deriveDefaultLabel` — canonical label string for round number +
  phase, including the `n = 1` no-prior-round case.
- `lib/mapApiError` — every `{status, code}` pair maps to the intended
  message + recovery, including the drift-heal cases and the `503`
  single-retry directive.
- `App` — load paths (`200` role derivation, `204` author→compose vs.
  bystander→ZeroData, error state); optimistic Done toggle + reconcile
  against the returned round; Ready-for-review reads ADO then calls
  `openRound` (with `label` omitted when untouched); Cancel-round
  confirmation flow; drift → refresh banner via fingerprint mismatch;
  polling paused during mutation / hidden tab.
- `components/*` — prop-driven rendering and the callbacks each control
  invokes (e.g. the Done checkbox is interactive only on the own,
  open-round row; frozen when closed; read-only for other rows).

Every `lib/` module has a test (a project code rule). Components are
tested for their rendered behavior, not their markup.

## Out of Scope

- **Round history / past-rounds view** — deferred, no data model yet.
- **Live push updates (SignalR)** — v1 is polling + the manual refresh
  banner only; no server push.
- **Interactive Teams card actions** ("mark Done" from a card) — Feature
  3 / v2.
- **Manual ADO↔Teams identity override UI** (`teamsIdOverride`) — schema
  field reserved, no UI in v1.
- **Any change to Feature 1's API or schema** — the drift model is
  deliberately client-side precisely to avoid needing an etag/`updatedAt`
  on `Round`.
- **The Teams bot / notification delivery** — Feature 3; the panel only
  triggers round open/close via the API, which owns notification firing.

## Further Notes

- The panel is a near-pure function of a single `getCurrentRound`
  response — deliberately, to keep the frozen-snapshot model honest and
  the component tree easy to test.
- Two intended consequences of the one-ADO-read-at-click model: (a) the
  snapshot can differ from what the author last saw in ADO's own
  reviewer UI — the snapshot _is_ the truth at click time; (b) drift is
  a client-computed heuristic — if a future `Round` field isn't in the
  fingerprint, a real change to it could be missed, so extend the
  fingerprint whenever the salient lifecycle fields grow.
- Deviation from `docs/handoff/panel-layout-spec.md`: the **Cancel
  round** control (component 7) is added; the spec has been amended to
  match (design log Q6).
- Verified against the codebase while writing this PRD: the `Round` type
  (`packages/api/src/lib/types/types.ts`) has no etag/`updatedAt`
  (confirming the fingerprint approach); the five routes and their
  status/error codes match the endpoint mapping above; `packages/extension`
  is an empty stub (`src/index.tsx` exports `{}`) with `react`,
  `azure-devops-ui`, `vitest`, and `@testing-library/react` present but
  `azure-devops-extension-api` absent (to be added); `vss-extension.json`
  already contributes the PR-detail tab and points its icon at a
  placeholder.

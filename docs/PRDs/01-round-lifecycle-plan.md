# Plan: Round Lifecycle (data + API)

> Source PRD: https://github.com/carlos-rezai/PRSync/issues/1

Feature 1 of PRSync: the **round** entity, its Table Storage
repository, and the rules that govern its lifecycle — opening,
per-reviewer done-toggles, quorum-based closing, and cancelling.
Fully testable through the API alone, behind a `NotificationPort`
seam (no-op logging stub in v1); no UI or bot dependency.

Terminology follows `docs/ubiquitous-language.md` exactly — `round`,
`phase`, `done`, `quorum`, `gating set`, `cancelled`, `PR key`,
`adoId`. Full rationale in `docs/design-logs/01-round-lifecycle.md`.

Each phase is a thin vertical slice cutting through every layer
(`functions/` → `services/` → `storage/` → `lib/`) with co-located
Vitest tests, built TDD (RED → build). Foundational `lib/` helpers
and the repository are folded into the first slice that exercises
them rather than shipped as un-demoable horizontal layers.

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes** (five endpoints; CORS locked to the ADO org origin; all
  require a valid ADO bearer token):
  - `GET  /api/prs/{prKey}/rounds/current` — latest round, any status
    → `200` / `204`; `400` malformed key
  - `POST /api/prs/{prKey}/rounds` — open next round
    → `201`; `409` already open · `422` tracked < quorum
  - `PATCH /api/prs/{prKey}/rounds/{n}/done` — toggle own Done
    → `200`; `403` not in snapshot · `409` not open · `401` unverified
  - `PATCH /api/prs/{prKey}/rounds/{n}` — edit label (author)
    → `200`; `403` not author · `409` not open
  - `POST /api/prs/{prKey}/rounds/{n}/cancel` — cancel round (author)
    → `200`; `403` not author · `409` not open
- **Schema** (one Table Storage entity per round):
  `PartitionKey = {projectId}:{repositoryId}:{pullRequestId}` (the
  **PR key** — raw PR number is not globally unique),
  `RowKey = ` zero-padded round number (`0001`). Fields:
  `roundNumber`, `phase` (`spec` | `implementation`, frozen after
  open), `label` (editable while open), `status`
  (`open` | `closed` | `cancelled`), `quorum` (snapshotted at open),
  `reviewers` (JSON string), `prTitle`, `prUrl`, `authorAdoId` /
  `authorName` / `authorEmail`, `openedAt`, optional `closedAt` /
  `cancelledAt`, `schemaVersion: 1`. All dates are ISO strings.
  Reviewer sub-object: `adoId` (immutable ADO GUID — the sole authz
  key), `email` (inert, for Teams resolution), `displayName`
  (cosmetic, escaped), `isRequired`, `done`, optional `doneAt`,
  reserved nullable `teamsIdOverride`.
- **Key models**: `Round`, `RoundReviewer`, `NotificationPort`
  (`roundOpened(RoundOpened)` / `roundClosed(RoundClosed)`),
  `RoundRepository`, `RoundService`.
- **Derived, never stored**: `doneCount`, "quorum met", and the
  gating set — all computed from `reviewers` + `quorum` at read time.
- **Close predicate**: `closed ⟺ doneCount ≥ quorum AND (all required
reviewers done)`. Gating set = required, non-container reviewers
  excluding the author; if none required, all tracked individuals
  gate. Required-clause is inert today (no required reviewers).
  Quorum default 2, snapshotted at open.
- **Layer discipline**: `functions/` is thin (zod-validate, call a
  service, map to HTTP — no business logic); `services/` owns
  lifecycle rules and triggers the port post-commit; `storage/` is
  the only layer touching `@azure/data-tables`; `lib/` is pure
  helpers, every function unit-tested.
- **Concurrency**: ETag `If-Match` on every mutation; bounded retry
  (3) on `412`; `503` on exhaustion. The open→closed transition and
  the author notification are bound to the single winning atomic
  conditional write.
- **Security invariants** (upheld from Phase 1, audited in Phase 4):
  point reads/writes only (injection impossible by construction — no
  user input ever enters an OData filter); no reviewer-id field
  (impersonation inexpressible); zod reject-unknown validation at the
  boundary; PII-safe logging (never log tokens or emails; correlate
  on PR key + round number).
- **Test infrastructure**: Vitest, tests co-located (`X.ts` /
  `X.test.ts`). `lib/` unit-tested (every function); `storage/` and
  `services/` behavioural tests against the **Azurite** emulator (or
  an in-memory fake); `functions/` contract tests on validation and
  status mapping.

---

## Phase 1: Open a round & read current

**User stories**: 1, 2, 3, 4, 6, 7, 15 (snapshot side), 20, 21, 27,
30, 31

### What to build

The first working end-to-end path: an author declares a PR ready for
review and a round is recorded; the panel can read the current round
in one request. `POST /rounds` snapshots the reviewers sent by the
client (dropping containers and the author), derives the round number
server-side (`lastRound + 1`, or 1 if none), freezes the phase,
generates a human-readable label, snapshots the quorum in force, and
persists one entity — refusing with `409` if a round is already open
and `422` if fewer tracked individuals than the quorum. `GET
/rounds/current` returns the latest round of any status, or an empty
`204` for a PR that has never had a round. Opening fires `roundOpened`
through the `NotificationPort` no-op stub post-commit.

This slice necessarily brings up the foundations every later phase
reuses: the `lib/` helpers (PR key build/parse, round-number
derivation, label generation, reviewer snapshot filtering), the
`RoundRepository` point read/write over Table Storage with `reviewers`
JSON (de)serialization, the `RoundService` open path, the
`NotificationPort` interface + stub, and zod boundary validation.

### Acceptance criteria

- [ ] `POST /api/prs/{prKey}/rounds` persists a round entity and
      returns `201` with server-owned `roundNumber`, `status: open`,
      `openedAt`, generated `label`, and snapshotted `quorum`.
- [ ] Round number is derived server-side: 1 when no prior round,
      else `lastRound + 1` (across closed/cancelled predecessors).
- [ ] Phase is frozen from the request; label is auto-generated from
      round number + phase.
- [ ] Reviewer snapshot drops containers and the author at snapshot
      time; only real, non-author individuals are tracked.
- [ ] Opening returns `409` when a round is already `open` on the PR.
- [ ] Opening returns `422` when tracked individuals < quorum.
- [ ] `GET /api/prs/{prKey}/rounds/current` returns `200` with the
      latest round (any status), or `204` for a PR with no rounds.
- [ ] `roundOpened` fires exactly once post-commit via the no-op stub
      (asserted against a spy port); a stub failure is isolated and
      never rolls back the open.
- [ ] Malformed `prKey` (not `guid:guid:int`), non-positive round
      params, unknown body fields, and oversized bodies are rejected
      at the boundary before any storage call.
- [ ] `lib/` helpers are exhaustively unit-tested; repository is
      tested against Azurite (point read/write, reviewers JSON
      round-trip, "no round" returns empty).

---

## Phase 2: Done-toggle & quorum close

**User stories**: 8, 9, 10, 11, 12, 13, 14, 15 (re-validate on
close), 25, 26, 28, 29

### What to build

A reviewer marks themselves Done on the open round, and the round
closes automatically the instant the quorum is met. `PATCH
/rounds/{n}/done` takes an absolute desired `done` state (idempotent)
whose target is _always_ the authenticated caller — there is no
reviewer-id field, so no one can toggle anyone else. The caller's ADO
bearer token is resolved to an identity that must match a snapshot
`adoId` (else `403`); optional reviewers are tracked but do not gate.
When the toggle brings `doneCount ≥ quorum`, the open→closed
transition and the `roundClosed` author notification are bound to the
single winning atomic conditional write, so concurrent final toggles
fire the safety signal exactly once. ETag `If-Match` guards every
write with a bounded retry on `412`; a toggle arriving after the round
has already closed is rejected `409` without re-notifying.

### Acceptance criteria

- [ ] `PATCH /api/prs/{prKey}/rounds/{n}/done` with `{ done }` sets
      the caller's own done state and returns `200`; the body carries
      no reviewer id.
- [ ] A caller whose resolved `adoId` is not in the snapshot is
      refused `403`; an unverified/invalid token is `401`.
- [ ] `done` is idempotent — a retried request yields the same result
      as a single request; un-marking Done while open is allowed.
- [ ] The round closes automatically when `doneCount ≥ quorum`
      (required-clause inert), setting `status: closed` and
      `closedAt`; the gating set excludes containers and the author,
      re-validated at close.
- [ ] `roundClosed` fires exactly once per close (asserted against a
      spy port), even under concurrent final toggles; retry losers
      observe `closed` and return `409` without re-notifying.
- [ ] A toggle on an already-closed round is rejected `409` without
      re-firing any notification; done state is frozen after close.
- [ ] Concurrent toggles are safe via ETag optimistic concurrency
      with bounded retry (3); exhaustion surfaces `503`.
- [ ] A `NotificationPort` failure post-commit is caught, logged, and
      isolated — never rolls back or fails the transition.

---

## Phase 3: Cancel & label edit

**User stories**: 5, 16, 17, 18, 19, 23, 34

### What to build

The author's two management actions on an open round. `POST
/rounds/{n}/cancel` moves the round to `cancelled` — a distinct
terminal state from `closed`, silent (no notification) — freeing the
PR so a fresh round can be opened; this covers the stuck-round case
that auto-close deliberately does not. `PATCH /rounds/{n}` edits the
label while the round is open — display-only, and never alters a
notification already sent. Both are author-only (resolved caller
`adoId` must equal `authorAdoId`, else `403`) and open-only (actions
on a non-open round are refused `409`). With cancel in place, the
full open → {closed | cancelled} → open (N+1) cycle is demonstrable.

### Acceptance criteria

- [ ] `POST /api/prs/{prKey}/rounds/{n}/cancel` sets `status:
    cancelled` and `cancelledAt`, returns `200`, and fires **no**
      notification.
- [ ] After cancel (or close), `POST /rounds` opens the next round at
      `lastRound + 1`.
- [ ] `cancelled` and `closed` are distinct terminal states —
      "closed" only ever means the safety signal fired.
- [ ] `PATCH /api/prs/{prKey}/rounds/{n}` edits the label while open
      and returns `200`; the edit does not alter any sent
      notification.
- [ ] Cancel and label-edit require caller `adoId == authorAdoId`;
      a non-author caller is refused `403`.
- [ ] Cancel and label-edit on a non-open (closed/cancelled) round
      are refused `409`.

---

## Phase 4: Cross-cutting security hardening

**User stories**: 22, 24, 32, 33 (reinforces 9, 31)

### What to build

A dedicated pass to make the security posture a verified acceptance
criterion across every endpoint rather than a per-phase afterthought.
CORS is locked to the ADO org origin. Every route — including `GET
current` — requires a valid ADO bearer token, so reviewer emails
(PII) are never served anonymously. All mutating actions are
authorized against the caller's immutable `adoId`, never email or
display name. A logging audit confirms no tokens or emails are ever
written to logs, correlating on PR key + round number instead. Body
size limits and the zod reject-unknown sweep are confirmed uniform
across all five endpoints.

### Acceptance criteria

- [ ] CORS is locked to the ADO org origin on all endpoints.
- [ ] Every endpoint, including `GET /rounds/current`, rejects
      missing/invalid tokens with `401` before any storage access.
- [ ] Every mutating action authorizes against the resolved `adoId`
      only — mutable email/display-name fields are never used for
      authz.
- [ ] A logging audit confirms no tokens or emails appear in any log
      line; correlation is on PR key + round number (+ `adoId`).
- [ ] Body-size limits and zod reject-unknown validation are verified
      uniform across all five endpoints.
- [ ] `functions/` contract tests cover malformed `prKey` / `{n}`,
      unknown-field rejection, and missing/invalid token → correct
      4xx before any storage call.

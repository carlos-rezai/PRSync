## Problem Statement

In AIUP-style development, a PR's implementation is regenerated from a
refined use case after every round of feedback rather than patched
commit-by-commit. That makes the _end of a review round_ the critical
moment: the author must not regenerate until it is genuinely safe, and
"safe" is not "one reviewer left a comment" — it is "enough reviewers
have finished their pass on _this_ round."

Today there is nothing that owns the concept of a round. There is no
record of when a round opened, who was reviewing it, whether each
reviewer has finished, or the instant the round is complete. Without a
backend that models this precisely — and does so securely, since it
handles reviewer identity and PII — neither the ADO panel (Feature 2)
nor the Teams notifications (Feature 3) have anything to build on.

## Solution

A backend — Azure Functions over Azure Table Storage — that owns the
**round** entity and every rule governing its lifecycle:

- **Opening** a round when the author clicks "Ready for review":
  server derives the round number, freezes the phase, snapshots the
  current ADO reviewer list, and records the quorum in force.
- A per-reviewer **Done toggle** that only the reviewer themselves can
  set, only while the round is open.
- **Closing** the instant a _quorum_ of Done signals is reached
  (default 2, not unanimity) — firing exactly one "safe to proceed"
  signal to the author.
- **Cancelling** an open round (author-only, silent) so a stuck round
  can be abandoned and a fresh one opened.

The whole feature is testable through the API alone, with notifications
abstracted behind a `NotificationPort` seam (a no-op logging stub in
v1). It is designed so that injection is impossible by construction and
impersonation is inexpressible, not merely denied.

## User Stories

1. As an author, I want to open a new round by declaring the PR ready
   for review, so that the round is recorded with the reviewers who are
   on the PR at that moment.
2. As an author, I want the round number derived server-side
   (`lastRound + 1`, or 1 if none), so that I cannot accidentally
   create a duplicate or out-of-order round.
3. As an author, I want a round's phase (`spec` or `implementation`)
   fixed when I open it, so that everyone reviews a stable definition
   of _what_ is under review.
4. As an author, I want a human-readable label auto-generated from the
   round number and phase, so that reviewers see a meaningful name
   without me typing one.
5. As an author, I want to edit the round label while the round is
   open, so that I can clarify its intent — without that edit altering
   any notification already sent.
6. As an author, I want the system to refuse to open a round when one
   is already open on the PR, so that there is never ambiguity about
   which round is live.
7. As an author, I want to be stopped from opening a round when there
   are fewer tracked reviewers than the quorum, so that I never open a
   round that can never close.
8. As a reviewer, I want to mark myself Done on the current round, so
   that I signal I have finished my pass without approving/rejecting in
   ADO.
9. As a reviewer, I want my Done toggle to apply only to me, so that no
   one — including a malicious caller — can mark me Done or un-Done.
10. As a reviewer, I want to un-mark Done while the round is still open,
    so that I can correct a mistaken click.
11. As a reviewer, I want my Done state frozen once the round closes, so
    that the historical record of the round is stable.
12. As an author, I want the round to close automatically the instant
    the quorum of Done signals is met, so that I do not have to watch
    for it.
13. As an author, I want exactly one "round closed / safe to proceed"
    signal per close, so that concurrent final toggles never double-fire
    a notification.
14. As an optional reviewer, I want to be tracked and notified on a
    round even though I do not gate its closing, so that I stay informed
    without blocking the team.
15. As the system, I want containers (teams/groups) and the author
    excluded from the gating set — at snapshot time and re-validated on
    close — so that only real, non-author individuals count toward
    quorum.
16. As an author, I want to cancel an open round, so that I can abandon
    a round opened by mistake or one whose quorum became unreachable.
17. As an author, I want cancelling to be silent (no notification) and
    to free the PR for a new round, so that abandonment is clearly
    different from a real close.
18. As a teammate, I want cancelled and closed to be distinct terminal
    states, so that "closed" always means the safety signal fired and
    never means "given up on."
19. As the author, I want to open the next round after a close or a
    cancel, so that the PR can go through as many rounds as the work
    needs.
20. As a caller of the panel, I want to read the current round (latest,
    any status) in a single request, so that the UI can render round
    state cheaply.
21. As a caller, I want a clear "no round yet" response (empty, not an
    error) for a PR that has never had a round, so that the panel can
    render an empty state.
22. As the system, I want every mutating action authorized against the
    caller's immutable ADO identity GUID (`adoId`), never email or
    display name, so that identity cannot be spoofed via mutable fields.
23. As the system, I want author-only actions (cancel, label edit) to
    require the caller's `adoId` to equal the round's author, so that
    reviewers cannot cancel or rename someone else's round.
24. As the system, I want even `GET current` to require a valid ADO
    token, so that reviewer emails (PII) are never served anonymously.
25. As the system, I want concurrent Done toggles to be safe via ETag
    optimistic concurrency with a bounded retry, so that simultaneous
    clicks do not corrupt the round or lose a toggle.
26. As the system, I want a Done toggle that arrives after the round has
    already closed to be rejected without re-notifying, so that late
    writers cannot reopen or re-fire a closed round.
27. As the system, I want the quorum in force snapshotted into the round
    at open time, so that changing the quorum config does not move the
    goalposts on an in-flight round.
28. As the system, I want a Done toggle to be an idempotent set of an
    absolute desired state, so that a retried request produces the same
    result as a single request.
29. As the system, I want a notification failure to be caught, logged,
    and isolated after commit, so that a flaky notifier never rolls back
    or fails a legitimate round transition.
30. As a developer, I want the notification trigger expressed as a
    domain-language port (`roundOpened` / `roundClosed`), so that
    Feature 3's bot adapter drops in behind it without touching
    lifecycle logic.
31. As an operator, I want malformed inputs (bad PR key, non-positive
    round number, unknown fields, oversized bodies) rejected at the
    boundary, so that no malformed data ever reaches storage.
32. As an operator, I want no tokens or emails ever written to logs, so
    that the system is PII-safe; correlate on PR key + round number
    instead.
33. As a caller, I want to toggle Done on a round I am not a snapshotted
    reviewer of to be refused (`403`), so that only tracked reviewers
    participate.
34. As a caller, I want actions on a non-open round (toggle, cancel,
    label edit) refused with a conflict, so that terminal rounds are
    immutable.

## Implementation Decisions

**Modules (deep modules, isolated interfaces):**

- **`lib/` pure helpers** — no I/O, every function unit-tested:
  - PR key build/parse (`{projectId}:{repositoryId}:{pullRequestId}`).
  - Round-number derivation (`lastRound + 1`, or 1).
  - Label generation from round number + phase.
  - Reviewer snapshot filtering (drop containers and the author).
  - Gating-set computation + close predicate
    (`doneCount ≥ quorum AND all required done`; required-clause inert
    today).
- **`storage/RoundRepository`** — the _only_ layer touching
  `@azure/data-tables`. Point reads/writes by exact keys, ETag
  concurrency, `reviewers` JSON (de)serialization. No OData filters
  built from user input.
- **`services/RoundService`** — lifecycle rules: open (server-owned
  number/status/timestamps, `409`/`422` guards, quorum snapshot),
  done-toggle + atomic close, cancel, label edit; triggers the
  `NotificationPort` post-commit.
- **`services/NotificationPort`** — interface
  (`roundOpened(RoundOpened)` / `roundClosed(RoundClosed)`) plus the
  v1 no-op logging stub.
- **`functions/` HTTP entry points** — thin: zod-validate input, call a
  service, map result to HTTP. No business logic.

**Entity schema (one entity per round):**
`PartitionKey = {projectId}:{repositoryId}:{pullRequestId}`,
`RowKey = ` zero-padded round number. Fields: `roundNumber`, `phase`,
`label`, `status` (`open`|`closed`|`cancelled`), `quorum`, `reviewers`
(JSON array), `prTitle`, `prUrl`, `authorAdoId`/`authorName`/
`authorEmail`, `openedAt`, optional `closedAt`/`cancelledAt`,
`schemaVersion: 1`. All dates are ISO strings. Reviewer sub-object:
`adoId`, `email`, `displayName`, `isRequired`, `done`, optional
`doneAt`, reserved nullable `teamsIdOverride`. `doneCount`, quorum-met,
and the gating set are **derived, never stored**.

**Close predicate:** `closed ⟺ doneCount ≥ quorum AND (all required
reviewers done)`. Gating set = required, non-container reviewers
excluding the author; if none required, all tracked individuals gate.
Quorum default 2, snapshotted at open.

**API surface (five endpoints; CORS locked to the ADO org origin; all
require a valid ADO bearer token):**

| Method & route                            | Purpose                           | Success       | Key errors                                                |
| ----------------------------------------- | --------------------------------- | ------------- | --------------------------------------------------------- |
| `GET /api/prs/{prKey}/rounds/current`     | latest round (any status)         | `200` / `204` | `400` malformed key                                       |
| `POST /api/prs/{prKey}/rounds`            | open next round                   | `201`         | `409` already open · `422` tracked < quorum               |
| `PATCH /api/prs/{prKey}/rounds/{n}/done`  | toggle own Done (target = caller) | `200`         | `403` not in snapshot · `409` not open · `401` unverified |
| `PATCH /api/prs/{prKey}/rounds/{n}`       | edit label (author)               | `200`         | `403` not author · `409` not open                         |
| `POST /api/prs/{prKey}/rounds/{n}/cancel` | cancel round (author)             | `200`         | `403` not author · `409` not open                         |

**Authorization:** done-toggle target is always the authenticated
caller — there is no reviewer-id field, so impersonation is
inexpressible. Bearer token resolved against ADO → identity must match
a snapshot `adoId`. Cancel and label-PATCH require caller `adoId ==
authorAdoId`. `GET current` requires a valid token (no anonymous PII
reads).

**Concurrency & exactly-once close:** ETag `If-Match` on every
mutation; bounded retry (3) on `412`; `503` on exhaustion. The
open→closed transition and the author notification are bound to the
single winning atomic conditional write; retry losers observe `closed`
and return `409` without re-notifying.

**Notification seam:** `NotificationPort` called post-commit; failures
caught, logged, isolated — never fail or roll back a transition. v1 is
a no-op logging stub; Feature 3 supplies the Bot Framework adapter (and
any outbox for delivery reliability) behind the same interface.

**Frozen-snapshot rule:** the reviewer list is copied from ADO at open
time and never re-synced. There is no auto-close on ADO reviewer
removal — that was dropped as conflicting with both the snapshot rule
and the quorum model; the author's Cancel round covers the stuck case.

## Testing Decisions

Good tests exercise **external behaviour** through a module's public
interface — the lifecycle rules and HTTP contract — never private
implementation shape. Derived state (doneCount, gating set) is asserted
through the observable outcome (does the round close?), not by reaching
into internals.

- **`lib/` helpers** — exhaustively unit-tested (project rule: every
  `lib/` function has a test). Pure functions, table-driven cases: PR
  key round-trips and rejects malformed input; round-number derivation
  across none/closed/cancelled predecessors; label generation per
  phase; snapshot filtering drops containers and the author; close
  predicate across below/at/above quorum and the (inert) required
  clause.
- **`storage/RoundRepository`** — integration-tested against the
  **Azurite** emulator: point read/write, reviewers JSON round-trip,
  ETag conflict surfaces as a retryable error, "no round" returns
  empty.
- **`services/RoundService`** — behavioural tests over the repository
  (real Azurite or an in-memory fake): open guards (`409` already open,
  `422` tracked < quorum), done-toggle authorization (caller must be a
  snapshot reviewer), atomic close fires `roundOpened`/`roundClosed`
  **exactly once** (assert against a spy `NotificationPort`), late
  toggle on a closed round rejected without re-notifying, cancel is
  silent and terminal, author-only guards on cancel/label.
- **`functions/`** — contract tests on validation and status mapping:
  malformed prKey/`{n}`, unknown-field rejection, missing/invalid token
  → correct 4xx before any storage call.

Prior art: none yet in-repo (this is Feature 1); these tests establish
the pattern. Framework is **Vitest**, tests co-located
(`RoundService.ts` / `RoundService.test.ts`).

## Out of Scope

- The ADO extension panel UI (Feature 2) and the Teams bot / real
  notification delivery (Feature 3). This feature stops at the
  `NotificationPort` seam with a no-op stub.
- Round history / list endpoints — latest-round-only in v1.
- Interactive Teams card actions ("mark Done" from a card) — v2.
- The `teamsIdOverride` manual ADO↔Teams mapping UI — schema field
  reserved, no behaviour.
- Auto-close on ADO reviewer removal and any live ADO membership
  polling — deliberately ruled out (snapshot is authoritative).
- Phase editing after open — corrected via cancel + reopen; no
  endpoint.
- A dedicated Entra app registration (audience-scoped JWT) — deferred
  hardening; v1 pays one ADO identity resolution per mutating call.
- Request rate-limiting — accepted gap for an internal, authenticated
  tool.
- Reminder notifications for long-pending reviews — deferred.

## Further Notes

- Terminology follows `docs/ubiquitous-language.md` exactly — `round`,
  `phase`, `done`, `quorum`, `gating set`, `cancelled`, `PR key`,
  `adoId`. Read it before naming anything.
- Full design rationale (Q&A, trade-offs, phased plan) lives in
  `docs/design-logs/01-round-lifecycle.md`. The build order is six thin
  vertical slices: (1) `lib/` helpers, (2) `RoundRepository`, (3)
  `RoundService` open + GET, (4) done-toggle + close, (5) cancel +
  label-PATCH, (6) cross-cutting security pass.
- Security is a first-class acceptance criterion, not an afterthought:
  injection eliminated structurally (point reads only), impersonation
  inexpressible (no reviewer-id field), zod reject-unknown validation
  at the boundary, PII-safe logging throughout.

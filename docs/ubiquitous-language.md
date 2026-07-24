# Ubiquitous Language

Single source of truth for domain terminology. Read before naming
anything. Update after every grill-me session.

Restructured 2026-07-24 during the round-lifecycle grill-me
(`docs/design-logs/01-round-lifecycle.md`), which also replaced the
unanimity close rule with a **quorum** and added the **cancelled**
state.

## Round lifecycle

| Term                         | Definition                                                                                                                                                                                               | Aliases to avoid         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Round**                    | A single cycle of review on a PR; opens on "Ready for review" and reaches a terminal state (`closed` or `cancelled`). A PR has many rounds over its life.                                                | Review, pass, cycle      |
| **Phase**                    | Which content a round reviews: `spec` (use case only) or `implementation` (use case + generated code). Set at open, frozen thereafter.                                                                   | Stage, type, mode        |
| **Round label**              | Human-readable name for a round (e.g. "Round 2 — Implementation Review"). Auto-generated from round number + phase, editable by the author while the round is open; snapshotted into a DM at send-time.  | Title, name              |
| **Ready for review**         | The single author action that opens the next round: sets phase, derives the round number, snapshots the reviewer list, and fires the round-opened notification.                                          | Submit, publish, start   |
| **Round opened** _(updated)_ | State `open` — the one live round on a PR. At most one round per PR is `open` at a time; opening while one is open is refused.                                                                           | —                        |
| **Round closed** _(updated)_ | Terminal state reached the instant the **quorum** of Done signals is met; fires the "safe to proceed" DM to the author. _(No longer triggered by reviewer removal — see Flagged ambiguities.)_           | Complete, finished       |
| **Cancelled** _(new)_        | Terminal state from the author's **Cancel round** action; abandons an open round (e.g. quorum became unreachable, or opened by mistake). Frees the PR to open a new round but fires **no** notification. | Aborted, closed, deleted |
| **Cancel round** _(new)_     | The author-only action that moves an `open` round to `cancelled`. Distinct from close: it is not a safety signal.                                                                                        | Abort, delete, discard   |

## Quorum & completion

| Term                           | Definition                                                                                                                                                                                                                       | Aliases to avoid               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Done** _(reviewer toggle)_   | A per-reviewer boolean meaning "I've finished my pass on this round." Owned exclusively by that reviewer; editable only while the round is `open`; frozen once the round closes. Separate from ADO's native Approve/Reject vote. | Approved, complete, signed-off |
| **Quorum** _(new)_             | The number of **Done** signals required to close a round — a configurable constant, default `2`. A round closes on `doneCount ≥ quorum`, not on unanimity; the quorum in force is snapshotted into the round at open time.       | Threshold, majority, consensus |
| **Gating set** _(new)_         | The reviewers whose Done state can count toward close: required, non-container individuals excluding the author; if none are required, all tracked individuals gate.                                                             | Approvers, blockers            |
| **Reviewer list** _(mirrored)_ | The set of reviewers PRSync tracks for a round, copied from ADO's PR reviewer list at open time and never re-synced live. ADO is the sole source of truth for who is a reviewer.                                                 | Participants, approvers        |

## Identity & entities

| Term                        | Definition                                                                                                                                                                                  | Aliases to avoid           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **PR key** _(new)_          | The globally-unique identifier for a PR: `{projectId}:{repositoryId}:{pullRequestId}`. Used as the Table Storage partition key, because a raw PR number is unique only within a repository. | PR id, PR number           |
| **adoId** _(new)_           | A person's immutable ADO identity GUID; the sole key PRSync authorizes actions against. Email and display name are never used as identity.                                                  | User id, email, uniqueName |
| **Author**                  | The person who owns the PR and opens/cancels its rounds; excluded from its own round's reviewer list. Receives the round-closed DM.                                                         | Owner, submitter           |
| **Reviewer**                | A tracked individual on a round's mirrored list. Toggles only their own Done; containers (teams/groups) and the author are never reviewers.                                                 | Approver, participant      |
| **teamsIdOverride** _(new)_ | A reserved, unused-in-v1 per-reviewer field for future manual ADO↔Teams identity mapping when email resolution fails.                                                                       | —                          |

## Notification

| Term                                  | Definition                                                                                                                                                                                 | Aliases to avoid      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| **PRSync** _(Teams identity)_         | The sender name on all Teams DMs; a personal 1:1 DM per person, delivered by a registered Azure Bot with proactive messaging (never a Teams incoming webhook).                             | Bot, webhook, channel |
| **Round-opened notification** _(new)_ | The DM sent to **every** tracked reviewer (required and optional) when a round opens.                                                                                                      | Reviewer alert        |
| **Round-closed notification** _(new)_ | The single "safe to proceed" DM sent to the author when a round closes.                                                                                                                    | Author alert          |
| **NotificationPort** _(new)_          | The domain-language seam (`roundOpened` / `roundClosed`) that round-lifecycle calls to trigger DMs; in v1 a no-op logging stub, with the real bot adapter supplied by Feature 3 behind it. | Dispatcher, notifier  |

## Relationships

- A **PR** (identified by its **PR key**) has many **Rounds**; at most
  one is `open`.
- A **Round** has one **Phase**, one **Round label**, one **Quorum**,
  and one mirrored **Reviewer list**.
- A **Round** closes when its **Done** count reaches its **Quorum**;
  only the **Gating set** contributes.
- A **Round closed** transition fires one **Round-closed notification**
  to the **Author**; **Round opened** fires a **Round-opened
  notification** to every **Reviewer**.
- A **Reviewer** and an **Author** are each a person keyed by **adoId**;
  the same person may author some rounds and review others.
- **Cancelled** and **Round closed** are both terminal; only **Round
  closed** notifies.

## Example dialogue

> **Dev:** "When two of the three reviewers click **Done**, does the
> **Round** close even though the third hasn't looked?"
> **Domain expert:** "Yes — close is on **Quorum**, default 2, not
> unanimity. The third reviewer's **Done** just freezes."
> **Dev:** "And if someone gets pulled off the PR so we can never reach
> two?"
> **Domain expert:** "PRSync doesn't watch ADO for that — the
> **Reviewer list** is a snapshot. The **Author** uses **Cancel round**;
> it goes **Cancelled**, nobody gets a DM, and they can open a fresh
> **Round**."
> **Dev:** "So only a real close sends the author's 'safe to proceed'?"
> **Domain expert:** "Right — **Round closed** fires the
> **Round-closed notification**; **Cancelled** is silent."

## Flagged ambiguities

- **"Close" vs. "cancel"** — both end a round, but only **Round
  closed** (quorum met) is a safety signal that notifies the author.
  **Cancelled** is a silent abandonment. Never use "closed" for a
  cancelled round.
- **Unanimity vs. quorum (resolved)** — earlier drafts said a round
  closes when _every_ reviewer is Done. That is superseded: close is on
  **Quorum** (`doneCount ≥ quorum`), a configurable count.
- **Auto-close on removal (removed)** — earlier drafts auto-closed a
  round when a pending reviewer was removed in ADO. Dropped: it
  conflicts with the frozen **Reviewer list** and is moot under
  **Quorum**. The author's **Cancel round** covers the stuck case.
- **Done vs. Approve** — a reviewer's **Done** toggle is PRSync-internal
  and distinct from ADO's native Approve/Reject vote; they are not
  linked.
- **adoId vs. email** — identity is always **adoId**; email is inert
  data used only for Teams resolution, never for authorization.

## Deferred / not yet modeled

- Round history (past closed rounds) — deferred, no data model yet
- Reminder notifications for long-pending reviews — deferred
- **teamsIdOverride** UI (manual ADO↔Teams mapping) — schema field
  reserved, no UI yet
- Interactive Teams card actions ("mark Done" from the card) — v2

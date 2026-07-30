# Ubiquitous Language

Single source of truth for domain terminology. Read before naming
anything. Update after every grill-me session.

Restructured 2026-07-24 during the round-lifecycle grill-me
([`01-round-lifecycle.md`](design-logs/01-round-lifecycle.md)), which
also replaced the unanimity close rule with a **quorum** and added the
**cancelled** state.

Extended 2026-07-27 during the Teams-notifications grill-me
([`03-teams-notifications.md`](design-logs/03-teams-notifications.md)),
which added the **Teams delivery** vocabulary and promoted the
**NotificationPort** from a no-op stub to a real queue producer.

Extended 2026-07-30 during the user-docs grill-me
([`04-user-docs.md`](design-logs/04-user-docs.md)), which added the
**Documentation** vocabulary — the **Operator**, the three documents
and what each owns, and the **Gloss** rule that keeps plain language
from contradicting this file. No lifecycle or delivery term changed.

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

| Term                                      | Definition                                                                                                                                                                             | Aliases to avoid      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **PRSync** _(Teams identity)_             | The sender name on all Teams DMs; a personal 1:1 DM per person, delivered by a registered Azure Bot with proactive messaging (never a Teams incoming webhook).                         | Bot, webhook, channel |
| **Round-opened notification** _(updated)_ | The domain event fired when a round opens; fans out to one **Notification message** per tracked reviewer (required and optional).                                                      | Reviewer alert        |
| **Round-closed notification** _(updated)_ | The domain event fired when a round closes; produces the single "safe to proceed" **Notification message** addressed to the author.                                                    | Author alert          |
| **NotificationPort** _(updated)_          | The domain-language seam (`roundOpened` / `roundClosed`) that round-lifecycle calls to trigger DMs. Its implementation enqueues onto the **Notification queue** and does nothing else. | Dispatcher, notifier  |

## Teams delivery

Terms introduced during the Teams-notifications grill-me
(`docs/design-logs/03-teams-notifications.md`, 2026-07-27). These
describe how a fired notification becomes a DM in a named person's
Teams chat — the API side owns _which transition fires_, this
vocabulary owns _how it is delivered_.

| Term                                | Definition                                                                                                                                                        | Aliases to avoid              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Notification message** _(new)_    | One queued unit of delivery: exactly one DM to exactly one person, carrying a self-contained snapshot of everything the card needs. Never a reference to a round. | Event, payload, notification  |
| **Notification queue** _(new)_      | The Azure Storage Queue (`prsync-notifications`) that is the _entire_ boundary between the API and the bot — they share no code and no synchronous call.          | Bus, topic, channel           |
| **Conversation reference** _(new)_  | The Teams-issued handle that lets the bot open a personal 1:1 DM with one person; obtained only at **Install capture**, and dead once they uninstall.             | Chat id, address, handle      |
| **Teams identity** _(new)_          | The stored mapping from a person's normalized email to their **Conversation reference**. The delivery-side identity — never an authorization key.                 | User record, profile, account |
| **Install capture** _(new)_         | The moment a person sideloads PRSync in personal scope and the bot persists their **Conversation reference**. Without it a person is **Unreachable**.             | Registration, onboarding      |
| **Notification log** _(new)_        | The per-recipient record of one delivery outcome (`sent`, `no-identity`, `failed`), keyed by round, event and recipient; doubles as the dedupe check.             | Audit, history, receipts      |
| **Reachable / Unreachable** _(new)_ | Whether a person has a **Teams identity**. An **Unreachable** recipient is a logged fact, never an error and never a reason to fail or alter a round.             | Missing, invalid, failed      |
| **Terminal failure** _(new)_        | A delivery failure that retrying cannot fix — an **Unreachable** recipient or an unrecognised message version. Logged and completed, never retried.               | Permanent error, fatal        |
| **Transient failure** _(new)_       | A delivery failure that retrying may fix — a network or Bot Framework error. Thrown so the queue retries, then poisons.                                           | Temporary error, glitch       |
| **Help card** _(new)_               | The short reply the bot sends to any message a person types at it — the only way to confirm an install worked, since v1 cards are otherwise link-out only.        | Welcome message, greeting     |
| **Teams app package** _(new)_       | The sideloadable `prsync-teams.zip` (manifest + the two Teams icons), personal scope only — the Teams-side analogue of the extension's `.vsix`.                   | Teams app, bundle, install    |

## Panel (extension UI)

Terms introduced during the Extension Panel grill-me
(`docs/design-logs/02-extension-panel.md`, 2026-07-25).

| Term                          | Definition                                                                                                                                                                                                                          | Aliases to avoid          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Panel** _(new)_             | The PRSync PR-page surface — a React + `azure-devops-ui` tab contributed on the ADO pull-request page, running in an ADO-hosted iframe.                                                                                             | Widget, extension, tab    |
| **Viewer** _(new)_            | The person currently looking at the **Panel**. Resolves to exactly one role for the current round: **Author**, **Reviewer**, or **Bystander**. Identity is presentation-only (`SDK.getUser().id`), never trusted for authorization. | Current user, me          |
| **Bystander** _(new)_         | A **Viewer** who is neither the **Author** nor a tracked **Reviewer** of the current round; sees a read-only panel.                                                                                                                 | Observer, guest, other    |
| **Compose form** _(new)_      | The author-only controls (phase toggle + editable label) shown when no round is `open`, used to configure and fire the next **Ready for review**.                                                                                   | New-round form, draft     |
| **Drift** _(new)_             | A divergence between the round the **Viewer** is looking at and a freshly-polled round, caused by someone else's change. Surfaced via the **Refresh banner**, never silently patched.                                               | Staleness, desync         |
| **Round fingerprint** _(new)_ | A client-computed digest of a round's salient lifecycle fields (`roundNumber`, `status`, `phase`, `label`, per-reviewer `done`) used to detect **Drift**.                                                                           | Hash, checksum, version   |
| **Baseline** _(new)_          | The **Round fingerprint** of the last state the **Viewer** has seen or acted on; the viewer's own mutations reset it, so only others' changes register as **Drift**.                                                                | Snapshot, last-seen       |
| **Refresh banner** _(new)_    | The info `MessageCard` shown when polling detects **Drift**; the **Viewer** must click it to re-render — PRSync never silently live-patches an open panel.                                                                          | Toast, alert, live update |

## Documentation

Terms introduced during the user-docs grill-me
(`docs/design-logs/04-user-docs.md`, 2026-07-30). These name the
_people PRSync is written for_ and the _documents written for them_ —
the first vocabulary in this file that describes no runtime concept.

| Term                             | Definition                                                                                                                                                         | Aliases to avoid                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **Operator** _(new)_             | The person who stands PRSync up for an org and keeps it running; the only reader who holds Azure, Teams-tenant and ADO-org authority. Not a **Round** role.        | Admin, owner, maintainer         |
| **Teammate** _(new)_             | Any person PRSync is deployed for. Becomes **Author**, **Reviewer** or **Bystander** per **Round**, and is **Reachable** only after their own **Install capture**. | User, member, end user           |
| **Setup guide** _(new)_          | `docs/setup-guide.md` — the ordered path from nothing to a working PRSync, in eleven stages. Owns _sequence_ and names no setting value.                           | Install docs, getting started    |
| **User guide** _(new)_           | `docs/user-guide.md` — the **Teammate**'s manual. Authoritative for what PRSync _does_; every other surface is a **Derived surface**.                              | Manual, help, docs               |
| **Deployment reference** _(new)_ | `docs/deployment.md` — owns every setting _value_, the rationale behind it, and the failure symptoms. Read by lookup, never straight through.                      | Deployment guide, ops docs       |
| **Gloss** _(new)_                | A plain-language restatement that names its canonical term **verbatim** and adds the counter-intuitive consequence. The **User guide** glosses; this file defines. | Definition, explanation, summary |
| **Derived surface** _(new)_      | Any user-facing description that is not the **User guide** — the README, the Marketplace description, the Teams manifest's. May summarise; may never add a claim.  | Copy, listing, blurb             |

## Relationships

- A **PR** (identified by its **PR key**) has many **Rounds**; at most
  one is `open`.
- The **Panel** renders one **Round** (the current one) and derives the
  **Viewer**'s role — **Author**, **Reviewer**, or **Bystander** —
  against it.
- The **Panel** reads round state from the PRSync API; it reads ADO's
  live **Reviewer list** only at the **Ready for review** click (the
  snapshot moment), never on load or poll.
- Polling compares each fetched **Round fingerprint** against the
  **Baseline**; a mismatch is **Drift** and raises the **Refresh
  banner**.
- A **Round** has one **Phase**, one **Round label**, one **Quorum**,
  and one mirrored **Reviewer list**.
- A **Round** closes when its **Done** count reaches its **Quorum**;
  only the **Gating set** contributes.
- A **Round closed** transition fires one **Round-closed notification**
  to the **Author**; **Round opened** fires a **Round-opened
  notification** to every **Reviewer**.
- A **Round-opened notification** produces one **Notification message**
  per **Reviewer**; a **Round-closed notification** produces exactly
  one, for the **Author**. **Cancelled** produces none.
- Every **Notification message** goes onto the **Notification queue**
  and is resolved against a **Teams identity** to reach a
  **Conversation reference**; a person with no **Teams identity** is
  **Unreachable**, which is a **Terminal failure**.
- Each delivery attempt writes one **Notification log** row, which is
  also what prevents a redelivered message from sending a second DM.
- A person gains a **Teams identity** at **Install capture** and loses
  it when they uninstall the **Teams app package**.
- A **Reviewer** and an **Author** are each a person keyed by **adoId**;
  the same person may author some rounds and review others.
- **Cancelled** and **Round closed** are both terminal; only **Round
  closed** notifies.
- An **Operator** stands up one deployment; every **Teammate** on it
  performs their own **Install capture**, which no **Operator** can do
  on their behalf.
- The **Setup guide** ends by handing a **Teammate** the **User guide**;
  the **User guide** ends an unresolved "no DM arrived" at the
  **Operator**, who alone can read the **Notification log**.
- The **Setup guide** links into the **Deployment reference** for every
  value and every failure, and restates neither.
- The **User guide** carries a **Gloss** of each precise term; this file
  carries the definition. A **Derived surface** carries neither.

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
> **Dev:** "In the **Panel**, if I'm not on the PR at all, what do I
> see?"
> **Domain expert:** "You're a **Bystander** — read-only. Only the
> **Author** gets the **Compose form**, and only a snapshotted
> **Reviewer** gets a live **Done** checkbox."
> **Dev:** "And if a reviewer clicks **Done** while I'm looking, does my
> panel just change under me?"
> **Domain expert:** "No — polling notices the **Round fingerprint** no
> longer matches your **Baseline**, that's **Drift**, and you get a
> **Refresh banner** to click. We never silently live-patch."
> **Dev:** "When the **Round-opened notification** fires, does the API
> send the DMs?"
> **Domain expert:** "No — it puts one **Notification message** per
> **Reviewer** on the **Notification queue** and forgets about it. The
> bot resolves each one to a **Teams identity** and sends."
> **Dev:** "What if someone never installed the bot?"
> **Domain expert:** "They're **Unreachable**. That's a **Terminal
> failure** — we write a **Notification log** row saying so and move on.
> We don't retry, and the **Round** doesn't care."
> **Dev:** "And if Teams is having a bad day?"
> **Domain expert:** "**Transient failure** — the message goes back on
> the queue and retries. Which means a **Round-closed notification**
> might arrive twice. We'd rather the **Author** see it twice than never
> see it at all."
> **Dev:** "A **Teammate** says they never got a DM. Where do I send
> them?"
> **Domain expert:** "The **User guide** — and its first question is
> whether they ever installed the app, because without **Install
> capture** they're **Unreachable** and nothing told them. If that's not
> it, it ends at you: the **Operator** is the only one who can read the
> **Notification log**."
> **Dev:** "Can I install it for them?"
> **Domain expert:** "No. The **Operator** stands up the deployment;
> every **Teammate** captures their own **Conversation reference**."
> **Dev:** "The Teams listing says the **Author** hears back 'when the
> last reviewer marks themselves done'. Do I fix that in the listing?"
> **Domain expert:** "Fix it, yes — it contradicts **Quorum**. But
> that's a **Derived surface**: it summarises the **User guide** and
> never makes its own claim. The **User guide** carries the **Gloss**;
> this file carries the definition."

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
- **"Notification" is three things** _(new)_ — keep them apart. The
  **Round-opened / Round-closed notification** is the _domain event_; a
  **Notification message** is the _queued unit of delivery_, one per
  person; the DM is the _delivered artifact_. Never say "notification"
  bare when the count matters — one event can be five messages.
- **Two identities, two purposes** _(new)_ — **adoId** authorizes,
  **Teams identity** delivers. A person can be perfectly authorized and
  still **Unreachable**. Never resolve one from the other for
  authorization purposes.
- **Failed vs. Unreachable** _(new)_ — **Unreachable** means the person
  never installed the bot; nothing is wrong and nothing will be retried.
  `failed` in a **Notification log** row means delivery was attempted
  and did not succeed. Do not report the first as the second.
- **Duplicates over drops** _(new)_ — delivery is at-least-once by
  deliberate choice. A duplicate DM is an accepted outcome, not a bug;
  a _missing_ **Round-closed notification** is the failure the product
  exists to prevent.
- **Operator is not a Round role** _(new)_ — **Author**, **Reviewer**
  and **Bystander** are resolved against a **Round**; **Operator** is
  resolved against a _deployment_ and appears in no round, no panel and
  no notification. The same person is usually both, which is exactly
  why the words must not be traded.
- **Unanimity language is drift, not phrasing** _(new)_ — "when
  everyone has finished", "all reviewers", "signed off", "consensus"
  and "the last reviewer" all describe a close rule PRSync does not
  have. A round closes on **Quorum**. Found and corrected once already
  in the Teams manifest's description; any **Derived surface** is where
  it will happen again.
- **Define once, gloss anywhere** _(new)_ — this file defines a term;
  the **User guide** carries a **Gloss** of it. A **Gloss** that stops
  naming its canonical term verbatim has become a second, competing
  definition — which is the failure the split exists to prevent.
- **Author / Reviewer / Bystander are per-round roles, not accounts**
  _(new)_ — a **Viewer**'s role is resolved against the current round;
  the same person can be **Author** of one round and **Reviewer** or
  **Bystander** of another. The role governs only what the **Panel**
  renders — the API re-authorizes every action server-side by **adoId**.

## Deferred / not yet modeled

- Round history (past closed rounds) — deferred, no data model yet
- Reminder notifications for long-pending reviews — deferred
- **teamsIdOverride** UI (manual ADO↔Teams mapping) — schema field
  reserved, no UI yet
- Interactive Teams card actions ("mark Done" from the card) — v2
- Surfacing **Unreachable** reviewers in the **Panel** _(new)_ — the
  **Notification log** holds the data, but no API read path or panel
  state is modeled for it yet
- Any channel or group-chat surface _(new)_ — the **Teams app package**
  is personal scope only; there is no notion of a team-wide post
- In-panel help _(new)_ — the **Panel** has no help affordance, so the
  **User guide** is reached from outside it; adding one is product code
- Screenshots in either guide _(new)_ — ruled out while the **Panel** is
  dual-themed and no environment exists to capture it from

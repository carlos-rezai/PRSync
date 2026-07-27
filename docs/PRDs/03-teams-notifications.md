## Problem Statement

PRSync's whole reason for existing is a single moment: the instant every
reviewer has finished a round, the author needs to know it is safe to
regenerate the implementation. Features 1 and 2 built everything up to
that moment and stopped short of it. The round lifecycle fires
`roundOpened` / `roundClosed` through a `NotificationPort` whose only
implementation is `NoopNotificationPort` — a deliberate stub that
discards the event. The panel shows round state, but only to someone who
is already looking at the PR page.

So today the product still requires exactly the behaviour it was built
to remove: reviewers have to notice a round opened, and authors have to
keep checking the panel to find out their round closed. The "safe to
proceed" signal exists as a domain event and reaches nobody.

Worse, the seam that isolates port failures — correct, because a dropped
DM must never fail a committed round — means a swallowed exception is a
silently lost notification. For this product the notification _is_ the
feature: a missing "safe to proceed" is the exact failure PRSync exists
to prevent, and the current design would lose one without a trace.

There is also a deployment gap standing between the code and any of
this working. `packages/api/src/index.ts` is empty and nothing calls
`app.http()`: the five HTTP handlers are factories no runtime ever
registers, there is no `host.json`, and no composition root ever
constructs a `RoundService`. The API is fully tested and entirely
un-runnable, so there is currently no composition for a real
notification port to be installed into.

Finally, a notification carries user-controlled text and a
user-controlled URL into an Adaptive Card. `prUrl` arrives in the
`openRound` request body and is stored with no scheme validation, then
lands in an `Action.OpenUrl`; `prTitle`, `roundLabel` and `authorName`
land in `TextBlock` and `FactSet` content, which renders limited
markdown. A crafted PR title can inject a link into a DM PRSync sends
under its own name.

## Solution

A second Azure Function App — `packages/bot` — running a registered
single-tenant Azure Bot, decoupled from the API by an Azure Storage
Queue. The queue is the _entire_ boundary: the two apps share no code
and no synchronous call, deploy independently, and need no
service-to-service auth.

On the producing side, `QueueNotificationPort` implements the existing
`NotificationPort` and does exactly one thing: enqueue. `roundOpened`
fans out to one message per tracked reviewer; `roundClosed` produces one
message for the author; `cancelled` produces none, because cancellation
is silent by design. **The `NotificationPort` interface and every line
of `RoundService` are untouched** — the seam doing precisely the job it
was built for.

Each queued **notification message** is a self-contained, denormalized
snapshot of everything the card needs — never a reference to a round.
The bot never reads the Rounds table, so a round that mutates between
enqueue and send cannot make a "round opened" card render post-close
state.

On the consuming side, a queue-triggered worker resolves each message's
recipient to a **Teams identity** — a conversation reference captured
when that person sideloaded the bot in personal scope — builds the
appropriate Adaptive Card, and sends a personal 1:1 DM. Delivery is
at-least-once by deliberate choice: a `NotificationLog` row makes the
common case exactly-once, and the narrow crash window yields a duplicate
DM rather than a lost one. **Duplicates over drops.**

Failures are sorted into two kinds and nothing else. A **terminal
failure** — the recipient never installed the bot, or the message
carries an unrecognised `schemaVersion` — is logged and completed;
retrying teaches nothing. A **transient failure** — network, Bot
Framework — is thrown so the queue retries with backoff and eventually
poisons. An unreachable reviewer is a logged fact, never an error, and
never alters a round.

The security posture is defence at both ends: `openRound` tightens
`prUrl` to require an `https:` URL, and a pure `safeCardUrl` in the bot
omits the card's action entirely rather than emit a hostile one. All
card text is markdown-escaped uniformly, so nobody has to remember that
`FactSet` values are safer than `TextBlock` text.

Alongside this, Feature 3 builds the API's missing composition root —
`host.json`, `app.http()` registration for the five existing handlers at
the routes the panel already calls, and the wiring of
`TableStorageRoundRepository`, `IdentityResolver` and the new
`QueueNotificationPort`. Without it the "Ready for review → DM" loop
cannot be demonstrated end-to-end and the bot would be the only
deployable app in the repo.

## User Stories

### Receiving a notification

1. As a **reviewer**, I want a personal Teams DM the moment a round
   opens on a PR I'm on, so that I learn there is work for me without
   watching the PR page.
2. As an **author**, I want a personal Teams DM the moment my round
   closes, so that I know it is safe to regenerate the implementation
   without polling the panel.
3. As a **reviewer**, I want the DM to name the round I'm being asked to
   review, so that I can tell a spec round from an implementation round
   before opening anything.
4. As a **recipient**, I want the DM to show the PR title and author, so
   that I can identify the PR without clicking through.
5. As a **recipient**, I want an "Open PR" button on the card, so that
   one click takes me to the pull request.
6. As an **author**, I want the round-closed card to read as a
   completion — visually distinct from a request to act — so that I can
   tell at a glance which kind of message I've received.
7. As a **recipient**, I want the DM to come from a sender identified as
   PRSync, so that I recognise it among other bot messages.
8. As a **reviewer**, I want to be notified whether I'm a required or an
   optional reviewer, so that optional reviewers are not silently
   excluded from a round they're tracked on.
9. As an **author**, I want _no_ DM when I cancel a round, so that
   cancelling never reads as a safety signal.
10. As a **recipient**, I want the card to reflect the transition that
    actually caused it, so that a card cannot render state the round
    moved on to afterwards.
11. As an **author**, I want the label I edited before opening a round to
    be the label in the DM, so that the notification matches what I sent
    out.

### Installing and identity

12. As a **teammate**, I want to sideload PRSync into Teams in personal
    scope, so that the bot can DM me without any Teams Store listing.
13. As a **teammate**, I want my install to be captured automatically the
    moment I add the app, so that I don't have to register anywhere.
14. As a **teammate**, I want to message the bot and get a short reply,
    so that I can confirm my install actually worked — the only way to
    check, since v1 cards are otherwise link-out only.
15. As a **teammate**, I want my conversation reference refreshed
    whenever I interact with the bot, so that a stale reference doesn't
    silently stop my notifications.
16. As a **teammate**, I want uninstalling the app to delete my stored
    identity, so that PRSync holds my conversation reference exactly as
    long as I have the app installed.
17. As an **operator**, I want an uninstalled person's dead reference
    gone rather than retried, so that every future round doesn't burn
    five retries into the poison queue on their behalf.
18. As an **ADO user**, I want my ADO identity to resolve to my Teams
    identity by email, so that being added as a reviewer is all I have to
    do to be reachable.

### Delivery guarantees

19. As an **author**, I want a "safe to proceed" DM never to be silently
    lost, so that the one signal the product exists to deliver is
    durable.
20. As an **author**, I would rather receive a duplicate DM than miss
    one, so that transient infrastructure trouble degrades into noise
    instead of silence.
21. As a **reviewer**, I want a redelivered queue message not to send me
    a second DM in the ordinary case, so that duplicates stay rare
    rather than routine.
22. As an **operator**, I want a delivery that cannot succeed on retry to
    be completed rather than retried, so that the poison queue holds only
    genuinely unexplained failures.
23. As an **operator**, I want network and Bot Framework errors to retry
    with backoff and then poison, so that a Teams outage delays
    notifications instead of dropping them.
24. As an **operator**, I want one message per recipient rather than one
    per round, so that one unreachable person cannot block delivery to
    everyone else.
25. As an **operator**, I want a failure enqueuing message 3 of 5 to log
    and continue, so that a partial fan-out beats an aborted one.
26. As an **operator**, I want each delivery attempt to record its
    outcome, so that "who was notified for round 4" is answerable after
    the fact.
27. As an **operator**, I want an unreachable recipient recorded as
    exactly that, so that a person who never installed the bot is not
    reported as a failed delivery.
28. As an **author**, I want a person who never installed the bot to have
    no effect on my round, so that reachability never leaks into
    lifecycle behaviour.
29. As an **operator**, I want a message the bot doesn't understand to be
    completed rather than retried forever, so that a future schema change
    degrades safely.
30. As an **author**, I want a notification failure never to fail or roll
    back my committed round, so that the lifecycle stays correct
    regardless of Teams.

### Security

31. As a **reviewer**, I want a card's "Open PR" button never to carry a
    non-`https:` URL, so that a DM from PRSync cannot become a delivery
    vehicle for a hostile link.
32. As a **reviewer**, I want a card whose URL is unsafe to simply have
    no button, so that the notification still arrives with its
    information intact.
33. As an **author**, I want the API to reject a non-`https:` `prUrl` at
    the boundary, so that a hostile URL is never stored in the first
    place.
34. As a **reviewer**, I want a crafted PR title, round label or author
    name to render as literal text, so that nobody can inject a link into
    a message sent under PRSync's name.
35. As a **security reviewer**, I want the bot's message endpoint to
    validate the Bot Framework JWT on every request, so that an
    anonymous-auth Azure Function is not an open endpoint.
36. As a **security reviewer**, I want the bot registered single-tenant,
    so that the token audience is narrowed to the org's directory.
37. As a **security reviewer**, I want every table access to be an exact
    partition + row key operation, so that no user input can reach an
    OData filter.
38. As a **security reviewer**, I want the reason `/api/messages` must be
    anonymous documented, so that the combination is understood as
    deliberate rather than flagged as a mistake in every future review.

### Running and deploying

39. As a **developer**, I want the API's five HTTP handlers actually
    registered with the Functions runtime, so that the API is runnable
    rather than only testable.
40. As a **developer**, I want the registered routes and methods to match
    what the panel's `ApiClient` already calls, so that wiring the
    composition root doesn't silently break Feature 2.
41. As a **developer**, I want a single composition root constructing the
    repository, identity resolver and notification port, so that swapping
    the port is a one-line change in one place.
42. As a **developer**, I want a `prsync-teams.zip` produced by an npm
    script, so that packaging the Teams app mirrors how the extension
    produces its `.vsix`.
43. As a **developer**, I want the Teams manifest to declare personal
    scope only, so that the app cannot be installed into a channel this
    product has no surface for.
44. As a **developer**, I want the card builders pinned to the frozen
    handoff JSON by test, so that card drift becomes a red test rather
    than a surprise in someone's DM.
45. As a **developer**, I want the bot's Bot Framework dependency
    confined to one layer, so that the dispatcher is unit-testable with
    no Teams and no Bot Framework in the test.
46. As a **developer**, I want the bot package to follow the same
    folder-per-module, one-barrel-per-layer discipline as the other two
    packages, so that the monorepo reads as one codebase.
47. As an **operator**, I want the queue name and connection configurable
    by app setting, so that the two Function Apps can share or split
    storage accounts.
48. As an **operator**, I want deployment documentation covering bot
    registration, sideloading and the anonymous-endpoint rationale, so
    that a fresh environment can be stood up from the docs.

### Edge and empty states

49. As an **author**, I want a round opened with an empty tracked
    reviewer list to enqueue nothing and still open, so that an empty
    fan-out is not an error.
50. As a **reviewer**, I want to be notified even if I'm the only
    reviewer, so that a one-reviewer round behaves like any other.
51. As an **author**, I want a round that closes in the same request that
    opened it — quorum already reachable — to still produce both
    notifications, so that no transition is skipped.
52. As a **recipient**, I want a very long PR title or round label to
    render readably rather than break the card, so that the card degrades
    gracefully.
53. As an **operator**, I want a message whose recipient has no email to
    be terminal rather than retried, so that unresolvable data doesn't
    cycle through the queue.
54. As an **operator**, I want an email that differs only by case or
    whitespace to resolve to the same identity, so that ADO's casing
    doesn't decide whether someone is reachable.
55. As a **developer**, I want the local development story documented —
    Azurite queues plus a tunnel to reach `/api/messages` — so that the
    bot can be exercised before it is deployed.

## Implementation Decisions

### Topology

- `packages/bot` becomes its own Azure Function App, decoupled from
  `packages/api` by an Azure Storage Queue (`prsync-notifications`). The
  two apps share **no code and no synchronous call**; the queue is the
  entire boundary.
- Rejected: `packages/bot` as a library imported by the API — it creates
  a workspace dependency `@prsync/api → @prsync/bot`, and
  `func azure functionapp publish` does not reliably carry an
  npm-workspaces symlink into the published zip. Rejected: HTTP between
  the two — fixes packaging but invents a service-to-service auth
  problem. The queue removes both and buys delivery durability with the
  same decision.
- Rejected: a shared `packages/contracts` package for the envelope type —
  it reintroduces the workspace-dependency deploy problem for both apps
  to solve a twenty-line type. The type is declared twice: fully on the
  producer side, structurally narrower on the consumer side, with
  `schemaVersion` carrying the compatibility contract instead of the
  compiler.

### The queue envelope

- One **notification message** per recipient — never one per round.
  Per-recipient retry and poison, and one unreachable person cannot block
  the others.
- The message is a self-contained denormalized snapshot: schema version,
  event (`roundOpened` | `roundClosed`), PR key, round number, the
  recipient's ADO id / email / display name, and the card fields (round
  label, PR title, PR URL, author name). The bot never reads the Rounds
  table.
- Rejected: passing a round reference — it puts the round schema under
  two owners and opens a race where the round mutates between enqueue
  and send.
- The producer must encode messages in the form the Functions queue
  trigger decodes by default; the exact encoding is pinned by a producer
  test and verified against current Azure Functions Storage-extension
  documentation during implementation rather than assumed.

### Producer (`packages/api`)

- A new `QueueNotificationPort` module in the services layer implements
  the existing `NotificationPort`. It enqueues and does nothing else.
- `roundOpened` → one message per tracked reviewer (required **and**
  optional). `roundClosed` → one message, to the author. Cancellation
  produces nothing.
- Enqueue is sequential; a failure on one message logs and continues, so
  a partial fan-out beats an aborted one.
- `RoundService` and the `NotificationPort` interface are not edited.
  `NoopNotificationPort` stays in the codebase as the test/no-op
  implementation; only the composition changes which one is installed.
- `openRound`'s zod schema tightens `prUrl` to require an `https:` URL,
  rejecting anything else at the boundary with the existing 400 shape.

### API composition root (new, was missing)

- `packages/api` gains a `host.json` and a real entry point that
  registers all five HTTP handlers with `app.http()` at the routes and
  methods the panel's `ApiClient` already calls — pinned by test, so
  wiring the composition root cannot silently break Feature 2.
- The entry point constructs the `TableClient`, the
  `TableStorageRoundRepository`, the `IdentityResolver`, the
  `QueueNotificationPort` and the `RoundService`, reading connection
  settings from the environment. Default quorum comes from configuration
  with the documented default of 2.
- This is the one place that decides which `NotificationPort`
  implementation is live.

### Bot layers (`packages/bot/src`)

Same discipline as `packages/api`: folder-per-module with a co-located
test, exactly one barrel per layer, cross-layer imports through the
target barrel, within-layer imports by direct file path.

| Layer        | Modules                                                                      | Rule                                     |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `lib/`       | `normalizeEmail`, `dedupeKey`, `safeCardUrl`, `escapeCardText`, shared types | LEAF; every function tested              |
| `cards/`     | `reviewerCard`, `authorCard`                                                 | Pure; asserted against the handoff JSON  |
| `storage/`   | `TeamsIdentityRepository`, `NotificationLogRepository`                       | Only layer touching `@azure/data-tables` |
| `services/`  | `IdentityDirectory`, `NotificationDispatcher`                                | Business rules                           |
| `teams/`     | Adapter wiring, `TeamsSender`                                                | The ONLY module importing `botbuilder`   |
| `functions/` | `teamsMessages` (HTTP), `notificationWorker` (queue trigger)                 | Thin — delegate and return               |

- `teams/` is the exact analogue of the extension's `sdk/` layer: one
  module owns the vendor SDK, behind a `TeamsSender` port narrow enough
  that `NotificationDispatcher` is unit-testable with no Bot Framework in
  the test at all.

### Deep modules

- **`NotificationDispatcher`** — the deepest module in the feature. One
  method takes one notification message and encapsulates the entire
  delivery rule set: version check, dedupe check, identity resolution,
  card selection and construction, send, and outcome logging. Its
  interface is one function of one argument; everything the feature is
  _about_ lives behind it, and it is exercised without any
  infrastructure.
- **`IdentityDirectory`** — capture, resolve and forget a Teams identity.
  Three verbs hide email normalization, conversation-reference
  serialization and the repository entirely; the message handler and the
  dispatcher never touch a repository.
- **`TeamsSender`** — a port with a single send-a-card-to-a-conversation
  operation. Small on purpose: it is the seam, not the logic.

### Delivery semantics

- Dedupe is a `NotificationLog` table keyed
  `{roundNumber}|{event}|{recipientAdoId}` with `PartitionKey = prKey`,
  ordered **check → send → mark**. Rows carry a status of `sent`,
  `no-identity` or `failed`, plus a timestamp.
- Only `sent` and `no-identity` short-circuit a redelivery. A `failed`
  row is a record, not a suppression — the retry must still attempt.
- Rejected: claim → send. It never duplicates, but loses the
  notification permanently on a mid-send crash. Chosen deliberately:
  duplicates over drops.
- **Terminal** (log, complete the message, never retry): no conversation
  reference for the recipient; unrecognised schema version; a recipient
  with no resolvable email.
- **Transient** (throw, let the queue retry and poison after the host's
  default dequeue count): Bot Framework and network errors.
- Reachability lives entirely in the bot's `NotificationLog`. The round
  entity does not change and the API stays ignorant of Teams.

### Identity

- A `TeamsIdentities` table keyed by normalized (lowercased, trimmed)
  email, storing the AAD object id, the Teams user id, the serialized
  conversation reference, display name and an ISO timestamp. Resolution
  is a **point read** by partition + row key — no scan, no filter,
  injection impossible by construction, matching `RoundRepository`.
- This relies on the shared-tenant assumption already recorded in the
  ubiquitous language: ADO's `uniqueName` is the AAD UPN, which is the
  Teams email.
- The AAD object id is stored but unused as a key in v1. It is the
  migration path if email resolution proves unreliable, and what the
  reserved `teamsIdOverride` field would eventually carry.
- Captured on the install `conversationUpdate` (the bot itself in
  `membersAdded`), re-persisted on every subsequent inbound activity —
  references go stale, and refreshing on any activity is cheap insurance.
- Deleted on the uninstall `conversationUpdate` (the bot in
  `membersRemoved`): a dead reference otherwise burns retries into poison
  on every future round, and deleting keeps the PII story honest.

### Cards

- Typed card builders, no `adaptivecards-templating` dependency. The
  handoff cards live outside any package, so importing them at runtime
  means either a build-time copy that silently drifts or a cross-package
  path that breaks bundling.
- The frozen handoff JSON stays authoritative **by test**: the co-located
  tests read it by relative path (test-only — it never enters the
  bundle), substitute the placeholders, and assert deep equality.
- All card text is markdown-escaped uniformly, including `FactSet`
  values, so nobody has to remember which fields render markdown.
- `safeCardUrl` is pure and returns nothing for a non-`https:` URL; the
  builder then omits the card's action entirely rather than emitting a
  hostile one.

### Bot registration and messaging

- Single-tenant Azure Bot: the bot is sideloaded inside one org's tenant
  and will never be listed in the Teams Store, so single-tenant narrows
  the token audience to that directory.
- The bot is **not** notification-only. Notification-only reads as the
  tighter choice but costs three things: no way for a user to confirm
  their install worked, no activity-driven reference refresh, and a
  forced manifest change when v2 adds interactive card actions. One
  message handler replying with a short help card is worth all three.
  _Current Teams manifest semantics are to be verified against
  Microsoft's documentation during implementation._
- `/api/messages` must be anonymous-auth — Azure Bot Service cannot
  present a Function key. It is not an open endpoint: the adapter
  validates the Bot Framework JWT against the app id, password and tenant
  on every request. The rationale belongs in `docs/deployment.md`.

### Teams app package

- `packages/bot/teams/manifest.json` plus copies of the two existing
  Teams icons (already at the required dimensions), zipped by an npm
  `package` script into `prsync-teams.zip` — mirroring how
  `packages/extension` produces its `.vsix`. Personal scope only.

### Configuration

- Bot: app id, password, tenant id, app type (single-tenant), and the
  Tables connection string.
- API: a Queues connection string (may be the same storage account) and
  the notification queue name, defaulting to `prsync-notifications`.
- Neither package has a `host.json` today; both get one, and the bot's
  carries the queue trigger's batch and retry settings.

### Repo housekeeping

- The bot package gains real `build` / `test` / `lint` / `typecheck` /
  `package` scripts in place of its current "not started yet" echoes, and
  a `tsconfig.json` extending the shared base.
- The root `.husky/pre-commit` currently scopes `lint` to
  `--workspace @prsync/extension`; it is widened so the new package is
  covered by the same gate as the others.

## Testing Decisions

A good test here asserts **external behaviour** — what a caller or a
recipient can observe — and never the shape of the code that produces
it. Concretely: assert that a round-open enqueues one message per
tracked reviewer with the right recipients, not that a particular
private method ran; assert that an unreachable recipient results in a
completed message and a `no-identity` record, not that a specific `if`
branch was taken; assert that a built card deep-equals the frozen
handoff JSON with placeholders substituted, not that a builder helper
was called.

Prior art in the repo to follow:

- `packages/api/src/services/RoundService/RoundService.test.ts` — a
  service driven against an in-memory repository fake and a spy port,
  asserting observable lifecycle outcomes. The model for
  `NotificationDispatcher` against a fake `TeamsSender`.
- `packages/api/src/storage/RoundRepository/RoundRepository.test.ts` — a
  repository against a fake table client. The model for both bot
  repositories.
- `packages/api/src/functions/*/*.test.ts` — thin handler tests over
  status codes and delegation. The model for `teamsMessages` and
  `notificationWorker`.
- `packages/extension/src/test/packaging.test.ts` — file-and-build
  contracts asserted as tests rather than discovered at install time. The
  model for the Teams app package test.
- `packages/api/src/test/fixtures/` — shared builders and fakes outside
  the layer conventions, consumed by every layer's tests. The bot package
  gets the equivalent.

Modules under test (all of the following):

- **`lib/`** — every function, per project convention: email
  normalization across case and whitespace, dedupe key construction,
  `safeCardUrl` accepting `https:` and rejecting everything else,
  `escapeCardText` neutralising markdown control characters.
- **`cards/`** — both builders asserted against the frozen handoff JSON
  by deep equality, plus the action-omitted case when the URL is unsafe,
  plus escaping applied to every text-bearing field.
- **`storage/`** — `TeamsIdentityRepository` (upsert, point-read
  resolution, delete-on-uninstall, absent-row behaviour) and
  `NotificationLogRepository` (write outcome, read for dedupe, absent-row
  behaviour) against a fake table client.
- **`services/`** — `IdentityDirectory` capture/resolve/forget;
  `NotificationDispatcher` end-to-end against fakes: the happy path
  sends and logs `sent`; a redelivered message with a `sent` row sends
  nothing; a `failed` row does not suppress a retry; an unknown recipient
  logs `no-identity` and completes; an unrecognised schema version
  completes without sending; a Bot Framework error propagates so the
  queue retries.
- **`functions/`** — `teamsMessages` (install captures, uninstall
  forgets, any message yields the help card, activity refreshes the
  reference) and `notificationWorker` (delegates, and lets a transient
  failure escape so the host retries).
- **API producer side** — `QueueNotificationPort` against a fake queue
  client: one message per tracked reviewer on open including optional
  reviewers, exactly one message to the author on close, nothing on
  cancel, an empty reviewer list enqueuing nothing, a failure on one
  message logging and continuing, and the message encoding the queue
  trigger expects. Plus `openRound` rejecting a non-`https:` `prUrl`.
- **Composition root** — the registered routes and methods match what the
  panel's `ApiClient` calls, so Feature 2 cannot be silently broken by
  the wiring.
- **Teams app packaging** — a file-contract test in the spirit of the
  extension's: the manifest addresses only paths the package actually
  ships, scopes are personal-only, and the icons referenced exist at the
  dimensions Teams requires.

Not tested: the Bot Framework adapter's own JWT validation and the
Azure Functions host's retry/poison behaviour — both are infrastructure,
and a test would only re-implement a vendor.

## Out of Scope

- **Interactive card actions** — clicking "mark Done" from a Teams card
  and round-tripping through the bot. v2. v1 cards are link-out only.
- **Surfacing unreachable reviewers in the panel** — the
  `NotificationLog` holds exactly the data such an affordance would read,
  but it needs a new API read path and new panel state. Deferred, not
  designed here.
- **`teamsIdOverride` UI** — the schema field stays reserved and unused;
  no manual ADO↔Teams mapping surface.
- **Reminder notifications for long-pending reviews** — deferred.
- **Any channel or group-chat surface** — the Teams app package is
  personal scope only; there is no notion of a team-wide post.
- **Round history** — unchanged, still deferred.
- **Changing the round entity** — the round schema does not move for this
  feature. Reachability is the bot's concern.
- **Changing `RoundService` or the `NotificationPort` interface** — the
  seam is used, not modified.
- **A Teams Store listing** — sideloading within the org's tenant only.

## Further Notes

- The `NotificationPort` seam is the payoff of a decision made in Feature
  1: Feature 3 is purely additive on the API side, and the lifecycle
  service is not edited at all. If implementation finds itself wanting to
  change `RoundService`, that is a signal something has been mismodelled.
- "Notification" means three different things and the count matters: the
  **round-opened / round-closed notification** is the domain _event_; a
  **notification message** is the queued unit of delivery, one per
  person; the DM is the delivered artifact. One event can be five
  messages.
- Two identities, two purposes: **adoId** authorizes, **Teams identity**
  delivers. A person can be perfectly authorized and still unreachable.
  Never resolve one from the other for authorization.
- **Unreachable** is not **failed**. Unreachable means the person never
  installed the bot: nothing is wrong and nothing will be retried.
  `failed` means delivery was attempted and did not succeed.
- Accepted costs, recorded deliberately: two deploy targets and two sets
  of app settings; the envelope type declared twice; duplicate DMs
  possible by design; local development needing Azurite queues plus a
  tunnel to reach `/api/messages` from Azure Bot Service.
- The design log's implementation order is deliberately end-to-end at
  every step: install capture first (Teams → bot → storage → Teams), then
  the pure cards, then the worker driven by a hand-enqueued message —
  which is the first real DM — then the producer closing the loop, then
  packaging. The API composition root is a prerequisite of the producer
  step rather than part of it.
- Two things in the design log are explicitly flagged as general
  knowledge rather than verified fact and must be checked against current
  Microsoft documentation during implementation: Teams manifest semantics
  around notification-only bots, and the queue message encoding the
  Functions Storage extension expects.
- Full design rationale, including the options rejected and why, is in
  `docs/design-logs/03-teams-notifications.md` (Q1–Q15). Vocabulary is in
  `docs/ubiquitous-language.md` — the Teams delivery section was added by
  the same session.

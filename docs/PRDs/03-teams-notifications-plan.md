# Plan: Teams Notifications

> Source PRD: https://github.com/carlos-rezai/PRSync/issues/16

Feature 3 of PRSync: the component that finally delivers the signal the
product exists for. Features 1 and 2 built everything up to the moment
every reviewer finishes a round and stopped short of it — `roundOpened`
and `roundClosed` fire into a `NoopNotificationPort` that discards them.
This feature supplies the real adapter behind that same seam.

A second Azure Function App — `packages/bot`, running a registered
single-tenant Azure Bot — is decoupled from the API by an Azure Storage
Queue. The queue is the **entire** boundary: the two apps share no code
and no synchronous call, deploy independently, and need no
service-to-service auth. **`RoundService` and the `NotificationPort`
interface are not edited by any phase in this plan.** If a phase finds
itself wanting to, something has been mismodelled.

Terminology follows `docs/ubiquitous-language.md` exactly — and the word
"notification" carries three distinct meanings whose count matters: the
**round-opened / round-closed notification** is the domain _event_; a
**notification message** is the queued unit of delivery, one per person;
the DM is the delivered artifact. One event can be five messages. Full
rationale, including the options rejected and why, is in
`docs/design-logs/03-teams-notifications.md` (Q1–Q15).

Each phase is a thin vertical slice cutting through every layer it
touches, with co-located Vitest tests, built TDD (RED → build). Two
deliberate deviations from the design log's implementation order, both
in service of every phase being demoable on its own:

- The **Teams app package** (manifest, icons, zip script) moves from
  step 5 into Phase 1. Nobody can sideload the bot without it, so
  Phase 1 is not demoable otherwise.
- **Uninstall handling** moves from step 5 into Phase 1. It is the same
  `conversationUpdate` handler and the same repository as install
  capture; landing it there completes `IdentityDirectory`'s three verbs
  instead of reopening both files at the end.

## Architectural decisions

Durable decisions that apply across all phases:

- **Topology**: `packages/bot` is its own Azure Function App. The
  producer (`packages/api`) and consumer (`packages/bot`) communicate
  only through the Azure Storage Queue `prsync-notifications`. Rejected:
  a library import (`@prsync/api → @prsync/bot` is a workspace
  dependency `func azure functionapp publish` does not reliably carry
  into the published zip); HTTP between them (fixes packaging, invents a
  service-to-service auth problem); a shared `packages/contracts`
  package (reintroduces the same deploy problem to solve a twenty-line
  type).
- **Queue envelope** — one **notification message** per recipient, never
  one per round, so retry and poison are per-person and one unreachable
  recipient cannot block the others. Self-contained and denormalized;
  the bot never reads the Rounds table:

  ```ts
  interface NotificationMessage {
    schemaVersion: 1;
    event: "roundOpened" | "roundClosed";
    prKey: string;
    roundNumber: number;
    recipient: { adoId: string; email: string; displayName: string };
    card: {
      roundLabel: string;
      prTitle: string;
      prUrl: string;
      authorName: string;
    };
  }
  ```

  The type is declared **twice** — fully on the producer side,
  structurally narrower on the consumer side. `schemaVersion` carries
  the compatibility contract instead of the compiler, and an
  unrecognised value is terminal.

- **Bot layers** (`packages/bot/src/`) — the same discipline as
  `packages/api`: folder-per-module with a co-located test, exactly one
  barrel `index.ts` per layer as its public API, cross-layer imports
  through the target layer's barrel, within-layer imports by direct file
  path.

  | Layer        | Modules                                                                      | Rule                                     |
  | ------------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
  | `lib/`       | `normalizeEmail`, `dedupeKey`, `safeCardUrl`, `escapeCardText`, shared types | LEAF; every function tested              |
  | `cards/`     | `reviewerCard`, `authorCard`                                                 | Pure; asserted against the handoff JSON  |
  | `storage/`   | `TeamsIdentityRepository`, `NotificationLogRepository`                       | Only layer touching `@azure/data-tables` |
  | `services/`  | `IdentityDirectory`, `NotificationDispatcher`                                | Business rules                           |
  | `teams/`     | Adapter wiring, `TeamsSender`                                                | The ONLY module importing `botbuilder`   |
  | `functions/` | `teamsMessages` (HTTP), `notificationWorker` (queue trigger)                 | Thin — delegate and return               |

- **`teams/` is the extension's `sdk/` layer by analogy**: one module
  owns the vendor SDK behind a `TeamsSender` port narrow enough that
  `NotificationDispatcher` is unit-testable with no Bot Framework and no
  Teams in the test at all.
- **Three deep modules**: `NotificationDispatcher` (one method, one
  argument, encapsulating the entire delivery rule set — version check,
  dedupe, identity resolution, card selection, send, outcome logging);
  `IdentityDirectory` (capture / resolve / forget, hiding email
  normalization, conversation-reference serialization and the repository
  entirely); `TeamsSender` (a single send-a-card-to-a-conversation
  operation — small on purpose, it is the seam, not the logic).
- **Tables** — both point-read only, by exact partition + row key, so no
  user input can reach an OData filter (matching `RoundRepository`):
  - `TeamsIdentities` — `PartitionKey = "teams-identity"`,
    `RowKey = normalizeEmail(email)`, storing `aadObjectId` (stored,
    unused as a key in v1 — the migration path if email resolution
    proves unreliable), `teamsUserId`, the serialized
    `conversationReference`, `displayName`, and an ISO `updatedAt`.
  - `NotificationLog` — `PartitionKey = prKey`,
    `RowKey = {roundNumber}|{event}|{recipientAdoId}`, with
    `status: "sent" | "no-identity" | "failed"` and a timestamp.
- **Delivery semantics** — at-least-once by deliberate choice, ordered
  **check → send → mark**. Only `sent` and `no-identity` short-circuit a
  redelivery; a `failed` row is a record, not a suppression. Rejected:
  claim → send, which never duplicates but loses the notification
  permanently on a mid-send crash. **Duplicates over drops** — a lost
  "safe to proceed" is the exact failure this product exists to prevent.
- **Two failure kinds and nothing else**:
  - **Terminal** (log, complete the message, never retry): no
    conversation reference for the recipient; unrecognised
    `schemaVersion`; a recipient with no resolvable email.
  - **Transient** (throw, let the host retry with backoff and poison):
    Bot Framework and network errors.
- **Unreachable is not failed.** Unreachable means the person never
  installed the bot — nothing is wrong, nothing is retried, and the
  round is unaffected. Reachability lives entirely in the bot's
  `NotificationLog`; the round entity stays at `schemaVersion: 1` and
  the API stays ignorant of Teams.
- **Two identities, two purposes**: `adoId` **authorizes**, the Teams
  identity **delivers**. A person can be perfectly authorized and still
  unreachable. Never resolve one from the other for authorization.
- **API routes** (unchanged from Feature 1, registered for real in
  Phase 4, pinned by test to what the panel's `ApiClient` already
  calls):
  - `GET   /api/prs/{prKey}/rounds/current`
  - `POST  /api/prs/{prKey}/rounds`
  - `PATCH /api/prs/{prKey}/rounds/{n}/done`
  - `PATCH /api/prs/{prKey}/rounds/{n}`
  - `POST  /api/prs/{prKey}/rounds/{n}/cancel`
  - Plus the bot app's `POST /api/messages` — `authLevel: "anonymous"`
    of necessity, because Azure Bot Service cannot present a Function
    key. It is **not** an open endpoint: the adapter validates the Bot
    Framework JWT against the app id, password and tenant on every
    request. The combination looks alarming in review and is deliberate.
- **Cards**: typed builders, no `adaptivecards-templating` dependency.
  The frozen `docs/handoff/adaptive-cards/*.json` stays authoritative
  **by test** — the co-located tests read it by relative path
  (test-only, it never enters the bundle), substitute the `${...}`
  placeholders, and assert deep equality. All card text is
  markdown-escaped uniformly, including `FactSet` values, so nobody has
  to remember which fields render markdown.
- **Configuration**:

  ```
  # packages/bot
  MICROSOFT_APP_ID=
  MICROSOFT_APP_PASSWORD=
  MICROSOFT_APP_TENANT_ID=          # new — single-tenant
  MICROSOFT_APP_TYPE=SingleTenant   # new
  AZURE_TABLES_CONNECTION_STRING=

  # packages/api
  AZURE_QUEUES_CONNECTION_STRING=   # new — may be the same account
  PRSYNC_NOTIFICATION_QUEUE_NAME=   # new — default prsync-notifications
  ```

- **Testing posture**: assert **external behaviour** — what a caller or
  a recipient can observe — never the shape of the code producing it.
  Prior art to follow: `RoundService.test.ts` (a service against an
  in-memory repository fake and a spy port) for
  `NotificationDispatcher`; `RoundRepository.test.ts` (against a fake
  table client) for both bot repositories; the `functions/*` handler
  tests for `teamsMessages` and `notificationWorker`; the extension's
  `packaging.test.ts` for the Teams app package. Not tested: the Bot
  Framework adapter's own JWT validation and the Functions host's
  retry/poison behaviour — both are infrastructure, and a test would
  only re-implement a vendor.
- **Two items flagged as general knowledge, not verified fact** — both
  must be checked against current Microsoft documentation at the moment
  they are implemented rather than assumed: Teams manifest semantics
  around notification-only bots (Phase 1), and the queue message
  encoding the Functions Storage extension decodes by default
  (Phase 5, pinned by a producer test).

---

## Phase 1: Install capture + Teams app package

**User stories**: 7, 12, 13, 14, 15, 16, 17, 18, 35, 36, 37, 42, 43,
45, 46, 54

### What to build

The first end-to-end path, and the one that makes every later phase
possible: a teammate sideloads PRSync into Teams in personal scope, and
PRSync learns how to reach them.

`packages/bot` stops being a stub and becomes a real Azure Function App
— a `host.json`, a `tsconfig.json` extending the shared base, and real
`build` / `test` / `lint` / `typecheck` / `package` scripts in place of
its current "not started yet" echoes. The `teams/` layer wires the
adapter and owns the `botbuilder` import outright. A single HTTP
function receives every inbound activity and delegates to
`IdentityDirectory`, which hides email normalization, conversation-
reference serialization and the repository behind three verbs:

- **capture** — on the install `conversationUpdate` (the bot itself in
  `membersAdded`), take the conversation reference and persist a
  `TeamsIdentities` row keyed by normalized email. Nobody registers
  anywhere; adding the app _is_ the registration.
- **refresh** — re-persist on every subsequent inbound activity.
  References go stale, and refreshing on any activity is cheap
  insurance against notifications silently stopping.
- **forget** — on the uninstall `conversationUpdate` (the bot in
  `membersRemoved`), delete the row. A dead reference would otherwise
  burn the full retry budget into the poison queue on every future
  round, and deleting keeps the PII story honest: PRSync holds a
  conversation reference exactly as long as the person has the app
  installed.

Any message the teammate sends back gets a short help card in reply —
the only way for someone to confirm their install actually worked, since
v1 cards are otherwise link-out only. This is why the bot is
deliberately **not** notification-only: that setting reads as the
tighter choice but costs the install confirmation, the activity-driven
reference refresh, and a forced manifest change when v2 adds interactive
card actions.

Alongside it, the Teams app package: a manifest declaring **personal
scope only** — there is no channel surface in this product and the app
must not be installable into one — plus copies of the two existing Teams
icons (already at the required dimensions), zipped into
`prsync-teams.zip` by an npm `package` script, mirroring how
`packages/extension` produces its `.vsix`. Its contract is asserted as a
test in the spirit of the extension's packaging test, not discovered at
install time.

### Acceptance criteria

- [ ] `packages/bot` builds, tests, lints and typechecks as a real
      workspace package; its `host.json` and tsconfig are in place and
      it exposes an HTTP-triggered messaging endpoint
- [ ] Installing the app in Teams personal scope persists a Teams
      identity for that person, keyed by normalized email, with no
      further action on their part
- [ ] Any inbound activity from an already-installed person re-persists
      their conversation reference
- [ ] Sending the bot a message returns a short help reply
- [ ] Uninstalling the app deletes that person's stored identity
- [ ] Emails differing only by case or surrounding whitespace resolve to
      the same identity
- [ ] Every table access is an exact partition + row key operation — no
      OData filter is constructed anywhere
- [ ] `botbuilder` is imported by exactly one module, in `teams/`
- [ ] The messaging endpoint is anonymous-auth and the adapter validates
      the Bot Framework JWT against app id, password and tenant on every
      request; the bot is registered single-tenant
- [ ] `npm run package` in `packages/bot` produces `prsync-teams.zip`
- [ ] A packaging test asserts the manifest declares personal scope
      only, addresses only paths the package actually ships, and
      references icons that exist at the dimensions Teams requires
- [ ] Teams manifest semantics have been verified against current
      Microsoft documentation, not assumed
- [ ] The package follows the folder-per-module, one-barrel-per-layer
      discipline, and `.husky/pre-commit`'s `lint` step is widened off
      `--workspace @prsync/extension` so the new package is covered by
      the same gate

---

## Phase 2: Cards

**User stories**: 3, 4, 5, 6, 31, 32, 34, 44, 52

### What to build

The two Adaptive Cards a recipient will actually see, as pure typed
builders with no infrastructure and no templating dependency. The
reviewer card names the round being opened, shows the PR title and
author, and carries an "Open PR" action. The author card reads as a
_completion_ rather than a request to act — visually distinct, so a
glance is enough to tell the two apart — and carries the same action.

The frozen handoff JSON is authoritative by test: each builder's
co-located test reads the corresponding template by relative path
(test-only — it never enters the bundle), substitutes the placeholders,
and asserts deep equality. Card drift becomes a red test rather than a
surprise in someone's DM.

Two pure `lib/` helpers carry the security posture, and both are applied
by the builders rather than left to a caller to remember:

- **URL safety** — a non-`https:` URL yields nothing, and the builder
  then omits the card's action **entirely** rather than emitting a
  hostile one. The notification still arrives with all its information
  intact; it simply has no button.
- **Text escaping** — `TextBlock` renders limited markdown, so a crafted
  PR title, round label or author name could otherwise inject a link
  into a message sent under PRSync's own name. Every text-bearing field
  is escaped uniformly, including `FactSet` values, so nobody has to
  remember which fields are safer than others.

### Acceptance criteria

- [ ] Both builders produce cards deep-equal to the frozen handoff JSON
      with placeholders substituted
- [ ] The author card is visually distinct from the reviewer card as a
      completion signal
- [ ] The reviewer card names the round; both cards show the PR title,
      and the reviewer card the author name
- [ ] An `https:` URL produces an "Open PR" action; any other scheme
      produces a card with no action at all and the rest intact
- [ ] Markdown control characters in the round label, PR title and
      author name render as literal text in every text-bearing field
- [ ] A very long PR title or round label renders readably rather than
      breaking the card
- [ ] Every `lib/` function added here has a test, per project
      convention

---

## Phase 3: Worker — the first real DM

**User stories**: 19, 20, 21, 22, 23, 26, 27, 28, 29, 47, 53

### What to build

The consuming half of the queue, and the first phase that puts a real
message in a real person's Teams chat. A queue-triggered function
receives one notification message and does nothing but delegate to
`NotificationDispatcher` — the deepest module in the feature, taking one
message and encapsulating the whole delivery rule set behind a
single-argument interface: version check, dedupe check, identity
resolution, card selection and construction, send, and outcome logging.

Delivery is at-least-once and ordered **check → send → mark**. A
`NotificationLog` row keyed by round number, event and recipient makes
the common case exactly-once; the narrow window where a send succeeds
and the mark fails yields a duplicate DM on redelivery rather than a
lost one. Only `sent` and `no-identity` rows short-circuit a
redelivery — a `failed` row is a record, not a suppression, so a retry
must still attempt.

Every outcome is sorted into terminal or transient and nothing else. A
recipient with no conversation reference is **unreachable**, not
failed — recorded as exactly that, completed, never retried; a person
who never installed the bot is not a delivery failure. An unrecognised
schema version and a recipient with no resolvable email are terminal for
the same reason: retrying teaches nothing, and a future schema change
should degrade safely rather than cycle through the queue. Network and
Bot Framework errors are thrown so the host retries with backoff and
eventually poisons, turning a Teams outage into delayed notifications
instead of dropped ones.

The dispatcher is exercised end-to-end against fakes with no Bot
Framework and no Teams in the test at all — that is what the
`TeamsSender` port is for. Queue name and connection are app settings,
so the two Function Apps can share or split storage accounts.

_Demoable by hand-enqueuing a message into Azurite: a real DM lands._

### Acceptance criteria

- [ ] A queued notification message resolves its recipient, builds the
      card matching its event, sends a 1:1 DM, and records `sent`
- [ ] A redelivered message whose recipient already has a `sent` row
      sends nothing
- [ ] A `failed` row does not suppress a retry
- [ ] A recipient with no stored identity is recorded `no-identity`, the
      message is completed, and nothing is retried
- [ ] A message with an unrecognised schema version is completed without
      sending
- [ ] A message whose recipient has no resolvable email is terminal, not
      retried
- [ ] A Bot Framework or network error propagates out of the function so
      the host retries with backoff and eventually poisons
- [ ] Every delivery attempt records its outcome, so "who was notified
      for round 4" is answerable after the fact
- [ ] `NotificationDispatcher` is fully unit-tested against a fake
      `TeamsSender`, with no Bot Framework in the test
- [ ] The queue name and connection are configurable by app setting,
      defaulting to `prsync-notifications`
- [ ] A hand-enqueued message produces an actual DM in Teams

---

## Phase 4: API composition root

**User stories**: 39, 40, 41

### What to build

The deployment gap that has stood between `packages/api` and anything
running. Today `packages/api/src/index.ts` is empty, nothing calls
`app.http()`, and there is no `host.json`: the five HTTP handlers are
factories no runtime ever registers, and no composition root ever
constructs a `RoundService`. The API is fully tested and entirely
un-runnable.

This phase gives it a `host.json` and a real entry point that registers
all five handlers at the routes and methods the panel's `ApiClient`
already calls, and constructs the object graph — table client,
repository, identity resolver, notification port, service — reading
connection settings from the environment, with the default quorum coming
from configuration (documented default: 2).

It is deliberately one place, and the **only** place, that decides which
`NotificationPort` implementation is live. Phase 5 changes one line
here. The route and method contract is pinned by test, so wiring the
composition root cannot silently break Feature 2.

`NoopNotificationPort` stays installed for this phase and stays in the
codebase permanently as the test/no-op implementation.

_Demoable: `func start`, and the Feature 2 panel drives a real API for
the first time._

### Acceptance criteria

- [ ] `packages/api` has a `host.json` and an entry point that registers
      all five HTTP handlers with the Functions runtime
- [ ] A test asserts the registered routes and methods match what the
      panel's `ApiClient` calls
- [ ] One composition root constructs the table client, repository,
      identity resolver, notification port and round service from
      environment configuration
- [ ] Default quorum comes from configuration, documented default 2
- [ ] Swapping the notification port implementation is a one-line change
      in exactly one place
- [ ] The API starts locally and serves the panel end-to-end
- [ ] `RoundService` and the `NotificationPort` interface are unchanged

---

## Phase 5: Producer — closes the loop

**User stories**: 1, 2, 8, 9, 10, 11, 24, 25, 30, 33, 49, 50, 51

### What to build

The producing half, and the phase where the product finally does the
thing it exists for: clicking "Ready for review" in Azure DevOps puts a
DM in each reviewer's Teams chat, and the round closing puts a "safe to
proceed" DM in the author's.

A new `QueueNotificationPort` implements the existing `NotificationPort`
and does exactly one thing — enqueue. `roundOpened` fans out to one
message per tracked reviewer, **required and optional alike**, so an
optional reviewer is never silently excluded from a round they're
tracked on. `roundClosed` produces exactly one message, to the author.
Cancellation produces none: cancelling must never read as a safety
signal. Enqueue is sequential, and a failure on message 3 of 5 logs and
continues — a partial fan-out beats an aborted one.

Each message is a self-contained denormalized snapshot taken at the
moment of the transition, including the label the author edited before
opening. Because the bot never reads the Rounds table, a round that
mutates between enqueue and send cannot make a "round opened" card
render post-close state.

Installing it is the one-line change in Phase 4's composition root. The
producer's message encoding is pinned by test against what the Functions
queue trigger decodes by default — verified against current Azure
Functions Storage-extension documentation at implementation time rather
than assumed.

The other half of the security posture lands here too: `openRound`
tightens `prUrl` to require an `https:` URL, rejecting anything else at
the boundary with the existing 400 shape, so a hostile URL is never
stored in the first place. Phase 2 already ensures a stored-but-unsafe
URL cannot produce a hostile button — defence at both ends.

### Acceptance criteria

- [ ] Opening a round enqueues exactly one message per tracked reviewer,
      including optional reviewers, each addressed to that reviewer
- [ ] Closing a round enqueues exactly one message, to the author
- [ ] Cancelling a round enqueues nothing
- [ ] A round opened with an empty tracked reviewer list enqueues
      nothing and still opens
- [ ] A one-reviewer round notifies that reviewer like any other
- [ ] A round that closes in the same request that opened it produces
      both notifications
- [ ] The edited label is the label that appears in the DM
- [ ] A failure enqueuing one message logs and continues to the rest
- [ ] The message encoding matches what the queue trigger decodes by
      default, pinned by test and verified against current
      documentation
- [ ] A notification failure never fails or rolls back a committed round
- [ ] A recipient who never installed the bot has no effect on the round
- [ ] `openRound` rejects a non-`https:` `prUrl` at the boundary
- [ ] `RoundService` and the `NotificationPort` interface are still
      unchanged; `NoopNotificationPort` remains in the codebase
- [ ] End-to-end: "Ready for review" in ADO produces DMs; the round
      closing produces the author's "safe to proceed" DM

---

## Phase 6: Deployment docs + housekeeping

**User stories**: 38, 48, 55

### What to build

The documentation that lets a fresh environment be stood up from the
docs rather than from memory, extending `docs/deployment.md` — which
currently covers the API and extension and explicitly defers the bot to
this feature.

Three things need writing down. **Bot registration and sideloading**:
creating the single-tenant Azure Bot, its app settings, wiring its
messaging endpoint, and how a teammate installs the app from
`prsync-teams.zip`. **The anonymous-endpoint rationale**: why the bot's
messaging endpoint must be anonymous-auth and why that is not an open
endpoint — recorded once, deliberately, so the combination is understood
rather than flagged as a mistake in every future security review.
**The local development story**: Azurite queues plus a tunnel to reach
the messaging endpoint from Azure Bot Service, so the bot can be
exercised before it is deployed.

Also recorded here as accepted costs rather than oversights: two deploy
targets and two sets of app settings, the envelope type declared twice,
and duplicate DMs possible by design.

Finally, the deviations this feature introduced against the design log
and the earlier package layout are recorded in `.claude/CLAUDE.md` —
design logs are immutable snapshots, so deviations are noted, never
edited in.

### Acceptance criteria

- [ ] `docs/deployment.md` covers bot registration, app settings and
      sideloading end-to-end
- [ ] The anonymous-endpoint rationale is documented as deliberate, with
      the JWT validation that makes it safe
- [ ] The local development story — Azurite queues plus a tunnel — is
      documented and followable
- [ ] A fresh environment can be stood up from the docs alone
- [ ] Accepted costs and design deviations are recorded rather than left
      implicit

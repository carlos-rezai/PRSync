# PRSync — Coordinated Review Rounds for Spec-Driven PRs

## Project Overview

PRSync solves a specific problem with AI Unified Process (AIUP) style
development: when a PR's implementation is fully regenerated from a
refined use case after every round of feedback (rather than patched
commit-by-commit), the team needs to know the moment _every_ reviewer
has finished a round — not drip-fed one comment at a time — so the
author knows it's actually safe to regenerate.

PRSync is an Azure DevOps extension (a panel on the PR page) paired
with a Teams bot that DMs each person only what's relevant to them:
authors get notified when their round closes, reviewers get notified
when a new round opens on a PR they're on.

Portfolio project by Carlos Rezai, built with the intent of also using
it with his team at work, who practice AIUP day to day.

## Tech Stack

- **Extension (ADO panel):** React + TypeScript, Vite, `azure-devops-ui`,
  `azure-devops-extension-sdk`
- **API:** Azure Functions (TypeScript, Node.js)
- **Storage:** Azure Table Storage (`@azure/data-tables`) — one round
  per row, partitioned by PR id — plus Azure Queue Storage
  (`@azure/storage-queue`) for the notification queue, which is the
  entire boundary between the API and the bot Function Apps
- **Teams:** Azure Bot resource (Bot Framework, free F0 tier) — a
  personal 1:1 DM per person requires a real bot with proactive
  messaging; a Teams incoming webhook can only post to a channel or a
  pre-configured chat, never to an arbitrary individual user. The bot
  itself exists from v1: it sends static, non-interactive Adaptive
  Cards (link-out only). Only the _interactive_ card actions
  ("mark done" from Teams) are deferred to v2 — not the bot itself.
- **Testing:** Vitest (all four of `extension`, `api`, `bot` and `docs`).
  The `docs` workspace has no runtime to drive — its subject is this
  repo's prose, and its suite is what keeps the documentation from
  drifting out of agreement with the source.
- **Linting:** ESLint + Prettier + Husky (root-level, shared across
  packages). The ESLint half is a single flat `eslint.config.js` at the
  repo root — every workspace resolves it by ESLint's upward config
  search, so the rules cannot drift per package. Type-checked rules are
  on (`projectService`), with `no-explicit-any` and `no-console` as
  errors repo-wide and `eslint-plugin-react-hooks` scoped to
  `packages/extension`. `.husky/pre-commit` runs `lint`, then
  `typecheck`, then `test` — all three fan out with `--workspaces
--if-present`, so a package that omits one of those scripts is silently
  skipped by the gate rather than failing it.

## Monorepo Structure

This is an npm-workspaces monorepo, not a single deployable app —
the extension, API, and bot have different build tools and
deploy targets, so each is its own package.

```
PRSync/
├── .claude/
│   └── skills/
├── assets/                  # icon source + exported PNGs (ADO + Teams sizes)
├── packages/
│   ├── extension/          # ADO extension — packaged as a .vsix via tfx-cli
│   │   ├── src/             # seven layers, same folder-per-module shape as api
│   │   │   ├── sdk/         # the ADO host seam — the ONLY module that
│   │   │   │                #   imports azure-devops-extension-sdk
│   │   │   ├── api/         # the PRSync Function App client
│   │   │   ├── ado/         # Azure DevOps's own PR REST API (GitRestClient)
│   │   │   ├── lib/         # pure helpers + shared types (the LEAF layer)
│   │   │   ├── hooks/       # the panel's state machine (usePanelState)
│   │   │   ├── components/  # pure, prop-driven azure-devops-ui views
│   │   │   ├── App/         # the container: derive viewer, choose body
│   │   │   └── test/        # Vitest setup, shared fixtures, packaging tests
│   │   └── vss-extension.json
│   ├── api/                 # Azure Functions
│   │   └── src/             # four layers, each folder-per-module (see below)
│   │       ├── functions/   # HTTP entry points (round open/close, done-toggle)
│   │       │   ├── index.ts             # barrel — the layer's public API
│   │       │   ├── openRound/           # one folder per module, named for it...
│   │       │   │   ├── openRound.ts     #   ...holding the implementation...
│   │       │   │   └── openRound.test.ts #  ...and its co-located test
│   │       │   └── ...                  # toggleDone/, editLabel/, cancelRound/, ...
│   │       ├── services/    # round lifecycle, notification dispatch (same shape)
│   │       ├── storage/     # Table Storage driver + repository abstraction,
│   │       │                #   plus the notification Queue Storage client
│   │       └── lib/         # pure helpers, ADO/Teams identity resolution
│   └── bot/                  # Teams Bot Framework bot (a SECOND Function App) —
│       │                     #   static cards in v1, interactive actions in v2
│       ├── src/              # six layers, same folder-per-module shape (see below)
│       │   ├── functions/    # teamsMessages (HTTP), notificationWorker (queue)
│       │   ├── services/     # IdentityDirectory, NotificationDispatcher
│       │   ├── teams/        # the botbuilder seam — config, adapter, bot,
│       │   │                 #   messaging endpoint, proactive sender
│       │   ├── cards/        # reviewer + author Adaptive Cards (pure)
│       │   ├── storage/      # TeamsIdentities + NotificationLog repositories
│       │   ├── lib/          # pure helpers + shared types (the LEAF layer)
│       │   └── test/         # Vitest fixtures, packaging + layer-policy tests
│       └── teams/            # manifest.json + icons — zipped to prsync-teams.zip
│   └── docs/                 # the checks over the documentation — the ONLY
│       └── src/              #   workspace with no runtime and no build script
│           ├── lib/          # pure text over markdown (the LEAF layer)
│           ├── repo/         # the filesystem seam — the Repo port + readers
│           ├── checks/       # links, reachability, alias scan, surface text
│           └── test/         # the assertions about THIS repo's documents
├── docs/
│   ├── design-logs/
│   ├── PRDs/
│   ├── refactor-plans/
│   ├── handoff/              # panel layout spec, Adaptive Card JSON templates
│   ├── deployment.md         # how a fresh environment is stood up, all 3 targets
│   ├── setup-guide.md        # the Operator's ordered path, in eleven stages
│   ├── user-guide.md         # the Teammate's manual — authoritative on behaviour
│   ├── ubiquitous-language.md
│   └── dev-journal.md
├── package.json               # workspace root — orchestrates all packages
└── tsconfig.base.json          # shared compiler options, extended per-package
```

## Assets

`assets/` holds the icon source (`icon-master.svg`) and its exported
PNGs, sized per each platform's requirement:

- `icon-ado-128.png` — 128×128, Azure DevOps Marketplace listing icon
- `icon-teams-color-192.png` — 192×192, full flat square (Teams
  applies its own masking — never round the corners manually)
- `icon-teams-outline-32.png` — 32×32, white-only glyph on a
  transparent background (Teams sidebar/app-bar icon)

`packages/extension/vss-extension.json` currently points at a local
placeholder path — wire it to `assets/icon-ado-128.png` (or a copy
brought in at build time) once packaging is set up.

## Layer Responsibilities (within `packages/api/src/`)

| Layer        | Purpose                              | Rule                                                                            |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------- |
| `functions/` | HTTP entry points                    | Thin — parse input, call a service, return output                               |
| `services/`  | Round lifecycle, business logic      | Owns round open/close, done-toggle rules, notification triggering               |
| `storage/`   | Table Storage + Queue Storage access | Only layer that touches `@azure/data-tables` or `@azure/storage-queue` directly |
| `lib/`       | Pure helpers                         | No side effects, fully testable — e.g. ADO email → Teams identity resolution    |

**The key principle:** `functions/` never talks to Table Storage
directly — it goes through `services/`, which goes through `storage/`.
This mirrors the same discipline as `storage/` being the only layer
that touches the database directly — no layer skips past its
neighbor.

## Layer Responsibilities (within `packages/extension/src/`)

The panel follows the same rules — folder per module with a co-located
test, exactly one barrel `index.ts` per layer as its public API,
cross-layer imports through the target layer's barrel, within-layer
imports by direct file path.

| Layer         | Purpose                             | Rule                                                               |
| ------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `sdk/`        | The ADO host seam                   | The ONLY module that imports `azure-devops-extension-sdk`          |
| `api/`        | The PRSync Function App client      | Owns request construction; rejects with `ApiError`                 |
| `ado/`        | Azure DevOps's own PR REST API      | Via the typed `GitRestClient`, never a hand-rolled fetch           |
| `lib/`        | Pure helpers + shared types         | The LEAF layer — imports no other layer; every function has a test |
| `hooks/`      | The panel's state machine           | Owns when it reads, what it applies, what a failure does           |
| `components/` | Prop-driven `azure-devops-ui` views | Pure — no clients, no fetching; interactions call UP               |
| `App/`        | The container                       | Derive the viewer, choose the body, pass props — nothing else      |

**Note:** the `hooks/` layer was not in the design log's package layout
(`docs/design-logs/02-extension-panel.md`). It was added during the
issue #14 refactor rather than leaving a 474-line container. Design
logs are immutable snapshots, so the deviation is recorded here and in
`docs/refactor-plans/02-extension-panel-refactor.md`, not by editing
the log.

Test fixtures live in `packages/extension/src/test/fixtures/` —
`fixtures.ts` (domain builders), `fakes.tsx` (one complete typed fake
per injected client, plus `renderApp`) and `panelDom.ts` (queries over
the rendered panel). They sit outside the layer conventions
deliberately: every layer's tests consume them, so putting them inside
any one module would force imports upward and across layers.

### Folder-per-module layout & barrels

Within each of the four layers, every module lives in its own folder
named after the module, holding the implementation file and its
co-located test under their existing names (`openRound/openRound.ts`,
`openRound/openRound.test.ts`) — the folder carries the module name; no
file is renamed to `index.ts`.

Each layer exposes exactly **one** `index.ts` barrel that re-exports
every module in that layer. This barrel is the layer's public API;
there are no per-module barrels. Adding a module means adding a folder
and one line to that layer's barrel, so the layer's public surface
stays explicit in one place.

**Import convention (two rules):**

- **Cross-layer** imports resolve through the target layer's barrel
  (`../../lib`, `../../storage`, `../../services`) — a consumer never
  names another layer's internal files.
- **Within-layer** imports between sibling modules use the sibling's
  direct file path (e.g. `../types/types`,
  `../NotificationPort/NotificationPort`), never the layer's own barrel
  — a module must not import the barrel that re-exports it, to avoid
  import cycles.

The api package builds through `tsconfig.build.json` with
`moduleResolution: "Node"`, which resolves a folder import to its
compiled `index.js`, so barrels work in both source and build. That
config also excludes tests from `dist/` — they are the only files that
reach for `import.meta`, which CommonJS output cannot carry — while
`tsconfig.json` (what `typecheck` reads) keeps the base ESNext/Bundler
pair so those tests still typecheck. Same split as `packages/bot`.

`packages/api/package.json` `main` is `dist/index.js`: the composition
root, and in the Functions v4 model the whole of function discovery. The
host loads exactly what `main` names and registers whatever that file
registered — a `main` globbing the handler modules loads files that
contain no `app.http()` call, so the host starts, registers nothing, and
serves 404 for every route while looking healthy.

## Layer Responsibilities (within `packages/bot/src/`)

Same discipline again — folder per module with a co-located test, one
barrel `index.ts` per layer, cross-layer imports through the target
layer's barrel, within-layer imports by direct file path.

| Layer        | Purpose                                                                                                                                                                                             | Rule                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `lib/`       | `normalizeEmail`, `dedupeKey`, `safeCardUrl`, `escapeCardText`, `statusCodeOf`, shared types                                                                                                        | The LEAF layer — imports no other layer; every function has a test                           |
| `cards/`     | `reviewerCard`, `authorCard`                                                                                                                                                                        | Pure — asserted against the frozen `docs/handoff/` card JSON                                 |
| `storage/`   | `TeamsIdentityRepository`, `NotificationLogRepository`                                                                                                                                              | Only layer that touches `@azure/data-tables` directly                                        |
| `services/`  | `IdentityDirectory` (capture/resolve/forget), `NotificationDispatcher`                                                                                                                              | Owns which card, whose chat, what an unreachable recipient costs, and what is worth retrying |
| `teams/`     | `BotConfig` (the four auth settings), `BotAdapter` (the adapter, built once), `TeamsBot` (activity routing), `MessagingEndpoint` (HTTP ↔ Bot Framework translation), `TeamsSender` (proactive send) | The ONLY layer that imports `botbuilder`                                                     |
| `functions/` | `teamsMessages` (HTTP), `notificationWorker` (queue trigger)                                                                                                                                        | Thin — delegate and return                                                                   |

`teams/` is the exact analogue of the extension's `sdk/` layer: this layer
owns the vendor SDK, which is what lets `NotificationDispatcher` be driven
end-to-end against a fake `TeamsSender` with no Bot Framework in the test
at all.

The rule constrains _where_ the SDK may be imported, not that every module
in the layer must import it — `BotConfig` is pure, and two modules take
their collaborator as a **structural port** rather than as a vendor class:
`MessagingEndpoint` asks for a `ChannelRequestProcessor` and an
`ActivityRunner`, `TeamsSender` asks for a `ProactiveConversationOpener`.
Each names exactly one method, `CloudAdapter` and `ActivityHandler` satisfy
them without knowing they exist, so the composition root passes the real
adapter unchanged while both modules stay drivable with no Bot Framework in
the test. This is the same trick `QueueProducer` plays on the Azure queue
client in `packages/api` — **reach for it whenever a vendor class is what
is blocking a test.**

**Deviations recorded here rather than by editing
`docs/design-logs/03-teams-notifications.md`** — design logs are
immutable snapshots:

- The queue envelope type is declared in
  `services/QueueNotificationPort/QueueNotificationPort.ts` beside its one
  implementation, not in a separate `types.ts` as the log's comment says.
- `packages/bot/host.json` carries no queue-trigger batch or retry
  settings; the log anticipated some. The host's defaults are what ships,
  and the poison queue is the documented failure surface.
- Test fixtures live in `packages/bot/src/test/fixtures/`
  (`fixtures.ts`, `fakes.ts`, `cardShape.ts`, `sourceFiles.ts`), outside the
  layer conventions for the same reason the extension's do: every layer's
  tests consume them. `sourceFiles.ts` is the source walker `layerPolicy`
  reads the bot's own source with.
- The log's layer table describes `teams/` as adapter wiring plus the
  sender. It is now the five named modules in the table above — the issue
  #25 refactor split a single `BotHost` file that held the routing, the
  settings, the adapter and the HTTP translation at once.
- The documentation tests that used to sit here — `userDocs.test.ts` and
  `deploymentDocs.test.ts` — moved to `packages/docs` in the issue #32
  refactor. Exactly one of the files they read was in this package, and
  renaming a heading in the extension's Marketplace description turned the
  **bot's** suite red. `packages/bot` keeps only the two tests whose
  subject is the bot: `layerPolicy.test.ts` and `packaging.test.ts`.

**The other layer rule that matters here:** `functions/` is where the two
entry points are declared _and_ where their trigger options live
(`teamsMessagesOptions` pins `authLevel: "anonymous"` in code;
`notificationWorkerOptions` reads the queue name and connection setting).
Both are deployment-shaped values kept in source deliberately — see
`docs/deployment.md` for the anonymous-endpoint rationale.

## Layer Responsibilities (within `packages/docs/src/`)

Same discipline once more — folder per module with a co-located test, one
barrel `index.ts` per layer, cross-layer imports through the target
layer's barrel, within-layer imports by direct file path.

| Layer     | Purpose                                                                                              | Rule                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lib/`    | Pure text over markdown: `fences`, `section`, `githubSlug`, `boldedTerms`, `settingTokens`, `stages` | The LEAF layer — imports no other layer, touches no filesystem, every function has a test |
| `repo/`   | The filesystem seam: the `Repo` port, `repoAt`, `readDocument`, `sourceFiles`                        | The ONLY layer that performs I/O                                                          |
| `checks/` | The analyses: `unresolvedLinks`, `surfaceText`, `unanimityAliases`, `reachable`                      | Each takes a `Repo` and RETURNS findings; none of them asserts                            |

This workspace is the odd one out in exactly one way: it has no runtime.
It is private, has no `main` and no `build` script, so
`npm run build --workspaces --if-present` skips it and no deploy target
can ever include it. Its "product" is the repo's prose.

`repo/` is the exact analogue of the bot's `teams/` and the extension's
`sdk/`: the seam the rest of the workspace is kept away from. The `Repo`
port is what makes any of this testable — the failures these checks guard
against, a missing file or an anchor matching no heading, are precisely
what a **correct** repository cannot demonstrate, so every check is driven
against an in-memory `fakeRepo`. Same trick as `QueueProducer` and
`TeamsSender`.

Two kinds of test live here and the directory says which is which. Module
tests (`src/lib/*/`, `src/repo/*/`, `src/checks/*/`) drive one function
against a fake or a string literal and can demonstrate failure. Repo
assertions (`src/test/*.test.ts`) point the checks at _this_ repository
and expect no findings — they cannot demonstrate failure, which is why
each is paired with a floor asserting something was actually scanned.
`src/test/documents.ts` is the registry of what counts as user-facing;
adding a document is one entry there and no signature change anywhere.

**Two things about this workspace worth knowing before changing it:**

- `readSourceFiles` is **duplicated on purpose**. `repo/sourceFiles/` is
  one copy and `packages/bot/src/test/fixtures/sourceFiles.ts` is the
  other, because `layerPolicy.test.ts` still needs a walker over the bot's
  own source. Sharing one means a workspace-to-workspace dependency, which
  this repo has declined twice before — for `NotificationMessage` and for
  `statusCodeOf`. Two copies of a 25-line walk, each beside its consumer
  and each with its own test, is the same trade already recorded twice,
  and this one is test-only so it cannot reach a deploy at all. Recorded
  in `docs/deployment.md`'s accepted costs.
- The three assertions in `src/test/projectInstructions.test.ts` whose
  subject is **this file** **skip when it is absent**. It is gitignored, so
  a fresh clone was never given it to drift from; they still run, and still
  fail on real drift, in any working copy that has it. Two of them are
  deliberately generalised rather than pinned by name — the layer table
  check reads every workspace that has layers, and the build-status check
  compares the README's table against the entries above — so the next
  workspace and the next feature are guarded without editing a test.

## Skills Location

All skills are in `.claude/skills/`. Read the relevant SKILL.md before
starting any task that matches its description. (Skills to be added —
see below.)

## Development Workflow

The personal workflow used throughout this project:

1. `grill-me` → shared understanding of the design
2. `write-a-prd` → reads design-log → GitHub issue + `docs/PRDs/`
3. `prd-to-plan` → phased plan on the issue
4. `prd-to-issues` → individual issues
5. `tdd` → failing tests (stops at RED)
6. `build` → implement
7. `request-refactor-plan` → create issue
8. `refactor` → clean up
9. (no `ui-meridian` equivalent yet — the extension panel follows
   `docs/handoff/panel-layout-spec.md` instead of a design system,
   since it must use `azure-devops-ui` to look native inside ADO)

## Ubiquitous Language

Single source of truth: `/docs/ubiquitous-language.md`. Read it before
naming anything — especially `round`, `phase`, `done`, and `ready for
review`, which all have precise, non-obvious meanings established
during the initial grill-me session. Update after every grill-me
session.

## Data Model

Defined through the initial grill-me session; full schema to be
formalized in `/docs/data-model.md` once storage implementation
begins. Core entity is the **round** (PR id, round number, phase,
label, snapshotted reviewer list, per-reviewer done state, open/closed
status), partitioned by PR id in Table Storage.

## Code Rules

- No `any` types — ever
- No business logic in `functions/` — extract to `services/`
- No `console.log` in committed code (use proper logging in
  `packages/api`, nothing in the extension bundle)
- All dates are ISO strings
- Co-locate tests with the file they belong to:
  `RoundService.ts` / `RoundService.test.ts`
- Every function in `lib/` must have a test
- The mirrored ADO reviewer list is a snapshot taken at round-open
  time — never re-fetch live ADO reviewer state mid-round to check who
  "counts"; this is a deliberate design decision, not an oversight

## Commit Message Convention

Convention used throughout this project:

```
<type>: [<initiative>] issue #<n> <description>
```

`<initiative>` is the PRD/feature initiative name (e.g. `round-lifecycle`,
`teams-notifications`) — not the issue title.

Examples:

```
feat: [round-lifecycle] issue #3 add reviewer done-toggle endpoint
fix: [teams-notifications] issue #7 correct email-to-Teams identity resolution
refactor: [round-lifecycle] issue #9 extract round-close service
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`

## Environment Variables

```
# packages/api
AZURE_TABLES_CONNECTION_STRING=   # Table Storage connection string (Rounds)
AZURE_QUEUES_CONNECTION_STRING=   # Queue Storage connection string — required, not
                                  #   optional: an API that starts healthy and
                                  #   quietly notifies nobody is the exact failure
                                  #   this product exists to prevent
PRSYNC_NOTIFICATION_QUEUE_NAME=   # optional; defaults to prsync-notifications.
                                  #   MUST match the bot's — the queue name is the
                                  #   only place the two Function Apps meet
PRSYNC_DEFAULT_QUORUM=            # optional; defaults to 2. Rejected rather
                                  #   than defaulted when set to a non-whole
                                  #   number, so a configured value is never
                                  #   silently replaced

# packages/bot
MICROSOFT_APP_ID=                   # Azure Bot resource's app ID (Bot Framework auth)
MICROSOFT_APP_PASSWORD=              # Azure Bot resource's client secret
MICROSOFT_APP_TENANT_ID=             # the one tenant the bot is registered in
MICROSOFT_APP_TYPE=                  # must be SingleTenant — the bot refuses to start otherwise
AZURE_TABLES_CONNECTION_STRING=      # Table Storage connection string (TeamsIdentities)
AZURE_QUEUES_CONNECTION_STRING=      # Queue Storage connection string — the DEFAULT setting the worker's trigger reads
PRSYNC_NOTIFICATION_QUEUE_NAME=      # optional; defaults to prsync-notifications
PRSYNC_NOTIFICATION_QUEUE_CONNECTION= # optional; NAMES the setting above, so the two Function Apps can split storage accounts

# packages/extension
VITE_API_BASE_URL=                  # base URL of the deployed Function App
```

Note: there is no service-hook listener. The extension calls Azure
DevOps's own REST API directly (via `azure-devops-extension-sdk`'s
built-in auth) to read the current reviewer list at the moment the
author clicks "Ready for review" — round-open is always a user action
inside the panel, never a passively-received ADO webhook.

Note: there is no Teams incoming-webhook URL. Personal 1:1 DMs require
a real bot with proactive messaging — each teammate installs the bot
once (sideloaded within the org's tenant), which lets the bot capture
a conversation reference per person. The bot then messages people
directly using those stored references, authenticated via
`MICROSOFT_APP_ID` / `MICROSOFT_APP_PASSWORD`, not a webhook URL.

## Build Status

Each feature below runs through the full skill loop independently —
`grill-me → write-a-prd → prd-to-plan → prd-to-issues → tdd → build →
request-refactor-plan → refactor` — before moving to the next. The
description under each is a starting point for that feature's grill-me
session, not a finished spec.

### Preliminary work

- [x] Initial grill-me session — round/phase/reviewer/notification data
      model established (see `docs/ubiquitous-language.md`)
- [x] Panel layout spec (`docs/handoff/panel-layout-spec.md`) — in
      place of a Claude Design prototype, since the panel must use
      `azure-devops-ui` components rather than custom design
- [x] Adaptive Card templates (reviewer + author notification)
- [x] Monorepo scaffold (extension / api / bot packages, docs/ tree)
- [ ] `.claude/skills/` — to be added

### Feature 1 — Round Lifecycle (data + API)

The round entity, its Table Storage repository, and the rules that
govern it: opening a round (increment from the last closed round, or
round 1 if none exists), the per-reviewer done-toggle (own-toggle-only,
editable only while open), round-closing the moment every snapshotted
reviewer is done, and auto-close if a pending reviewer is removed from
the PR. Fully testable via the API alone — no UI dependency, so this
is a legitimate first "done" independent of the panel.

- [x] Complete — round entity, Table Storage repository, lifecycle
      rules (open/toggle/close/cancel/edit-label), security hardening,
      and the folder-per-module refactor (issue #6). Full API suite
      green (125 tests).

### Feature 2 — Extension Panel

The PR-page panel from `docs/handoff/panel-layout-spec.md`, wired to
Feature 1's API: header, editable round label, phase toggle, reviewer
list with done checkboxes, the "Ready for review" button (author-only,
calls Azure DevOps's own REST API directly via the extension SDK to
snapshot the current reviewer list), round status pill, and the
polling + refresh-banner pattern (no silent live-patch).

- [x] Complete — the panel, wired to Feature 1's API: load sequence,
      viewer-role selection, Done toggle, Ready for review, label edit,
      cancel round, polling + refresh banner, theming and packaging
      (issues #8–#13), plus the test-architecture / `hooks`-layer
      refactor (issue #14). Full extension suite green (191 tests
      across 29 files).

### Feature 3 — Teams Notifications

An Azure Bot resource (Bot Framework, free F0 tier) connected to the
Teams channel, with `packages/api` (or `packages/bot`) as its
messaging endpoint. Each teammate installs the bot once in personal
scope (sideloaded within the org's tenant — no Teams Store listing),
which lets the bot capture and persist a conversation reference per
person. Email → Teams identity resolution (assumes shared tenant per
`docs/ubiquitous-language.md`) maps an ADO reviewer/author to their
stored conversation reference. On real round-open (to each snapshotted
reviewer) and round-close (to the author) events, the bot proactively
sends the appropriate Adaptive Card template as a personal 1:1 DM —
static and non-interactive in v1 (link-out only); see Deferred for the
interactive version.

- [x] Complete — install capture (`teamsMessages` + `IdentityDirectory` +
      `TeamsIdentities`), the two Adaptive Cards, the queue worker and
      `NotificationDispatcher` with its terminal-vs-transient rules, the
      `QueueNotificationPort` producer replacing `NoopNotificationPort` in
      the API's composition, Teams packaging (`prsync-teams.zip`), and the
      deployment docs (issues #18–#24), plus the `teams/`-layer split and
      coverage refactor (issue #25). Full bot suite green (121 tests across
      22 files); API suite 180, extension 191.

### Feature 4 — Documentation / User Manual

The user-facing documentation PRSync does not have. `docs/deployment.md`
covers standing an environment up, and the design logs, PRDs, refactor
plans and dev journal are the build's paper trail — every word of it
written for whoever _maintains_ PRSync, none of it for the teammate who
has to _use_ it. A reviewer who gets an unexpected DM, or an author
wondering why a round closed before the third reviewer looked, currently
has nothing to read.

The hard part is that the core terms are precise and counter-intuitive,
and a manual that paraphrases them loosely starts contradicting
`docs/ubiquitous-language.md`, which is the single source of truth:
**Done** is not ADO's Approve, a round closes on **quorum** rather than
unanimity, **cancel** and **close** are both terminal but only one
notifies, and the **reviewer list** is a snapshot that deliberately
ignores later ADO changes. So the grill-me has to settle how plain
language and the ubiquitous language stay in agreement — plus what a
person is told when a DM never arrives, since **Unreachable** is a
logged fact the panel does not surface.

There is also more than one user-facing surface, each maintained
separately today and free to drift: the ADO Marketplace listing, the
Teams manifest's description, this repo's README, and any in-panel help.
Worth deciding which is authoritative before writing four copies of the
same explanation.

Two audiences, which may or may not want the same document — a teammate
who needs to get their job done, and someone assessing the project. Also
unsettled: whether the manual carries screenshots, which are the fastest
thing in any repo to go stale.

Ships documentation, so it has no build dependency on Features 1–3 and
is a legitimate independent slice. Verifiable the way this project
already verifies docs — tests reading source and documentation together,
in the spirit of `packages/bot/src/test/deploymentDocs.test.ts`.

- [x] Complete — `docs/user-guide.md` and `docs/setup-guide.md`, the
      README front door, the derived-surface alias scan and the three
      readers routed with every link resolved (issues #26–#31), plus the
      `packages/docs` workspace refactor (issue #32) that moved the
      documentation checks out of the Teams bot, decomposed the 465-line
      markdown fixture into three layers, split the specs by subject and
      added the reachability and build-status drift checks. Docs suite
      green (101 tests across 20 files); api 180, bot 113, extension 191.

### Deferred

- [ ] Round history view
- [ ] Reminder notifications for long-pending reviews
- [ ] Interactive Teams card actions — clickable "mark done" directly from the card, round-tripping through the bot — v2
- [ ] Manual ADO↔Teams identity linking override UI — schema field reserved

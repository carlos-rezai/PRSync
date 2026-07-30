# PRSync

> Azure DevOps extension + Teams bot for coordinating review rounds on spec-driven PRs — built with a structured Claude Code workflow

PRSync tracks review rounds on a PR and tells each person exactly one thing at the right moment: reviewers get a personal Teams DM when a new round opens on a PR they're on, and the author gets a personal DM the moment the round reaches its quorum of **Done** ticks and closes — so it's actually safe to regenerate the implementation.

---

## Why This Project Exists

This project has two purposes:

1. **A real fix for a real workflow problem.** Under [AI Unified Process](https://unifiedprocess.ai/) (AIUP), a PR's implementation isn't patched commit-by-commit after feedback — the use case is refined and the whole implementation is regenerated. That makes "wait for all reviewers, then act" the _correct_ strategy, not a bottleneck to route around — but Azure DevOps and Teams give you no way to know when that point has actually been reached without manually pinging three people. PRSync makes that moment a single, personal notification.

2. **A portfolio demonstration of AI-assisted engineering.** Every feature is built using a structured Claude Code workflow: grill-me sessions, PRDs filed as GitHub issues, TDD, and a living ubiquitous-language document. The methodology is as much the point as the product.

---

## Documentation

Three readers, one document each:

| If you are…                                                   | Start here                                   | Which owns                                                                     |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| **Assessing this project** — how it was built, and why        | [`docs/design-logs/`](docs/design-logs)      | the reasoning, one immutable snapshot per feature                              |
| **Standing PRSync up** for an organisation (the **Operator**) | [`docs/setup-guide.md`](docs/setup-guide.md) | the ordered path from an empty Azure subscription to a working PRSync          |
| **Using PRSync** on your pull requests (a **Teammate**)       | [`docs/user-guide.md`](docs/user-guide.md)   | what PRSync does, what the panel shows, and what to do when a DM never arrives |

An assessor's shortest route is [How It Works](#how-it-works) below, then the design log for whichever feature looks interesting; [the paper trail](#the-paper-trail) is the rest of it.

[`docs/user-guide.md`](docs/user-guide.md) is authoritative for what PRSync does. This README, the Marketplace listing and the Teams app description are short summaries of it — where one of them says something the guide does not, the guide is the one to believe.

Two references sit behind those guides, read by lookup rather than straight through:

- [`docs/deployment.md`](docs/deployment.md) — every setting value, the reasoning behind it, and what each failure looks like. The setup guide links here for both and repeats neither.
- [`docs/ubiquitous-language.md`](docs/ubiquitous-language.md) — the single source of truth for PRSync's terminology. The user guide glosses five of these words; this file defines all of them.

### The paper trail

- [Design logs](docs/design-logs) — immutable per-feature design snapshots
- [PRDs and phased plans](docs/PRDs)
- [Refactor plans](docs/refactor-plans)
- [Panel layout spec](docs/handoff/panel-layout-spec.md) and [Adaptive Card templates](docs/handoff/adaptive-cards)
- [Dev journal](docs/dev-journal.md)

---

## How It Works

- A PR's review lifecycle is made of **rounds**. A round can review just the use case (`Use Case Review`) or the use case plus generated implementation (`Implementation Review`) — the author sets this explicitly, it's never inferred from the diff.
- The author clicks **Ready for review** to open a round. This snapshots the current Azure DevOps reviewer list, sets the round's label (auto-generated, editable), and fires a personal Teams DM to each reviewer.
- Each reviewer has their own **Done** toggle inside the PRSync panel on the PR page — editable only by them, and only while the round is still open. Azure DevOps's own Approve/Reject vote is untouched; Done is a coordination signal, not a merge gate.
- The round **closes** the moment **quorum** is reached — a configured number of Done ticks, two by default — and the author gets a personal Teams DM: safe to proceed. Because quorum is a count rather than the whole list, a round can close while somebody on the reviewer list has not looked at the PR yet.
- The next "Ready for review" click auto-increments to the next round and resets Done state for the new reviewer snapshot.

Personal DMs (rather than a shared channel) require a real Teams bot with proactive messaging — each teammate adds the bot once (sideloaded within the org's tenant, no Teams Store listing needed), after which PRSync can message them directly whenever they're an author or reviewer on an open round.

Full data model and decision log from the initial design session: [`docs/ubiquitous-language.md`](docs/ubiquitous-language.md).

---

## Development Methodology

Built using a structured Claude Code skill workflow. Every feature follows the same sequence before a line of code is written:

`grill-me` → `write-a-prd` → `prd-to-plan` → `prd-to-issues` → `tdd` → `build` → `request-refactor-plan` → `refactor`

**What this means in practice:**

- Every feature starts with a grill-me session — Claude interrogates the design until every assumption is resolved
- A PRD is written and filed as a GitHub issue before implementation begins
- Tests are written before code (TDD, stopping at RED)
- All domain terminology is locked in `docs/ubiquitous-language.md`

The `.claude/` folder contains all skill definitions. The `docs/` folder contains the full paper trail — the handoff spec, PRDs, and the ubiquitous language dictionary — so the reasoning behind every decision is readable alongside the code.

---

## Tech Stack

| Layer                | Choice                                           | Why                                                                                                                                                                              |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADO Extension        | React + TypeScript + Vite, `azure-devops-ui`     | Native look inside the Azure DevOps PR page                                                                                                                                      |
| Extension SDK        | `azure-devops-extension-sdk`                     | Official SDK for contributing panels to ADO pages                                                                                                                                |
| API                  | Azure Functions (Node.js + TypeScript)           | Event-driven — matches the bursty, webhook-triggered workload                                                                                                                    |
| Storage              | Azure Table Storage (`@azure/data-tables`)       | Single-entity model (round), no relational joins needed                                                                                                                          |
| Teams                | Azure Bot resource (Bot Framework, free F0 tier) | Personal 1:1 DMs require a real bot with proactive messaging — a Teams incoming webhook can only post to a channel or pre-configured chat, never to an arbitrary individual user |
| Teams (v1)           | Bot sends static, non-interactive Adaptive Cards | Link-out only — the bot exists in v1, but cards have no clickable actions yet                                                                                                    |
| Teams (v2, deferred) | Interactive card actions                         | Clickable "mark done" directly from the card, round-tripping through the bot                                                                                                     |
| Testing              | Vitest                                           | Consistent across both the extension and API packages                                                                                                                            |

---

## Project Structure

```
PRSync/
├── .claude/             # Claude Code skills and CLAUDE.md
├── assets/               # icon source (SVG) + exported PNGs for ADO and Teams
├── packages/
│   ├── extension/        # ADO extension — packaged as a .vsix
│   ├── api/               # Azure Functions
│   └── bot/                # Teams Bot Framework bot — static cards in v1, interactive actions deferred to v2
└── docs/
    ├── design-logs/       # Immutable feature design snapshots
    ├── PRDs/               # Product requirements and implementation plans
    ├── refactor-plans/     # Refactor RFCs filed as work items
    ├── handoff/             # Panel layout spec + Adaptive Card JSON templates
    ├── setup-guide.md       # The operator's ordered path, in eleven stages
    ├── user-guide.md        # The teammate's manual — authoritative on behaviour
    ├── deployment.md        # Every setting value, its rationale, its failure
    ├── ubiquitous-language.md
    └── dev-journal.md
```

---

## Running from Source

**To deploy PRSync**, follow [`docs/setup-guide.md`](docs/setup-guide.md) — the ordered path from an empty Azure subscription to a working install, including the tooling each stage needs. That is the one install story, and this section deliberately repeats no part of it.

**To work on the code**, you need Node.js 20+:

```
git clone https://github.com/carlos-rezai/PRSync.git
cd PRSync
npm install
npm test
```

`npm install` covers all three packages via npm workspaces, and `npm test` runs every suite. Exercising the API, the panel and the bot on your own machine additionally needs a storage emulator and a public tunnel — both are in [Local development](docs/deployment.md#local-development).

### Commit message convention

```
<type>: [<initiative>] issue #<n> <description>
```

`<initiative>` is the PRD/feature initiative name (e.g. `round-lifecycle`, `teams-notifications`) — not the issue title.

Examples:

```
feat: [round-lifecycle] issue #3 add reviewer done-toggle endpoint
fix: [teams-notifications] issue #7 correct email-to-Teams identity resolution
refactor: [round-lifecycle] issue #9 extract round-close service
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`

---

## Build Status

| Feature                                                          | Status           |
| ---------------------------------------------------------------- | ---------------- |
| Initial grill-me session (data model)                            | ✅ Complete      |
| Panel layout spec (in place of a Claude Design prototype)        | ✅ Complete      |
| Adaptive Card templates                                          | ✅ Complete      |
| Monorepo scaffold                                                | ✅ Complete      |
| 1. Round Lifecycle (data + API)                                  | ✅ Complete      |
| 2. Extension Panel                                               | ✅ Complete      |
| 3. Teams Notifications (bot registration + static cards)         | ✅ Complete      |
| 4. Documentation / User Manual (user + setup guides, front door) | 🟡 In progress   |
| Round history view                                               | ⏸ Deferred       |
| Reminder notifications                                           | ⏸ Deferred       |
| Interactive Teams card actions ("mark done" from Teams)          | ⏸ Deferred to v2 |

---

## Author

**Carlos Rezai** — Senior Software Engineer, Berlin
Building structured human-AI workflows and fullstack AI-powered products.

[GitHub](https://github.com/carlos-rezai) [LinkedIn](https://www.linkedin.com/in/aryan-carlos-r-0ba21017b/)

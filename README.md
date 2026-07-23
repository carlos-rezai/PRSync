# PRSync

> Azure DevOps extension + Teams bot for coordinating review rounds on spec-driven PRs — built with a structured Claude Code workflow

PRSync tracks review rounds on a PR and tells each person exactly one thing at the right moment: reviewers get a personal Teams DM when a new round opens on a PR they're on, and authors get a personal DM the moment every reviewer has finished — so it's actually safe to regenerate the implementation.

---

## Why This Project Exists

This project has two purposes:

1. **A real fix for a real workflow problem.** Under [AI Unified Process](https://unifiedprocess.ai/) (AIUP), a PR's implementation isn't patched commit-by-commit after feedback — the use case is refined and the whole implementation is regenerated. That makes "wait for all reviewers, then act" the _correct_ strategy, not a bottleneck to route around — but Azure DevOps and Teams give you no way to know when that point has actually been reached without manually pinging three people. PRSync makes that moment a single, personal notification.

2. **A portfolio demonstration of AI-assisted engineering.** Every feature is built using a structured Claude Code workflow: grill-me sessions, PRDs filed as GitHub issues, TDD, and a living ubiquitous-language document. The methodology is as much the point as the product.

---

## How It Works

- A PR's review lifecycle is made of **rounds**. A round can review just the use case (`Use Case Review`) or the use case plus generated implementation (`Implementation Review`) — the author sets this explicitly, it's never inferred from the diff.
- The author clicks **Ready for review** to open a round. This snapshots the current Azure DevOps reviewer list, sets the round's label (auto-generated, editable), and fires a personal Teams DM to each reviewer.
- Each reviewer has their own **Done** toggle inside the PRSync panel on the PR page — editable only by them, and only while the round is still open. Azure DevOps's own Approve/Reject vote is untouched; Done is a coordination signal, not a merge gate.
- The moment every reviewer has toggled Done, the round **closes** and the author gets a personal Teams DM: safe to proceed.
- The next "Ready for review" click auto-increments to the next round and resets Done state for the new reviewer snapshot.

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

| Layer                | Choice                                       | Why                                                           |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| ADO Extension        | React + TypeScript + Vite, `azure-devops-ui` | Native look inside the Azure DevOps PR page                   |
| Extension SDK        | `azure-devops-extension-sdk`                 | Official SDK for contributing panels to ADO pages             |
| API                  | Azure Functions (Node.js + TypeScript)       | Event-driven — matches the bursty, webhook-triggered workload |
| Storage              | Azure Table Storage (`@azure/data-tables`)   | Single-entity model (round), no relational joins needed       |
| Teams (v1)           | Incoming webhook, personal DM per person     | Static Adaptive Cards, no bot registration needed for v1      |
| Teams (v2, deferred) | Bot Framework bot                            | Interactive "mark done" action directly from the card         |
| Testing              | Vitest                                       | Consistent across both the extension and API packages         |

---

## Project Structure

```
PRSync/
├── .claude/             # Claude Code skills and CLAUDE.md
├── assets/               # icon source (SVG) + exported PNGs for ADO and Teams
├── packages/
│   ├── extension/        # ADO extension — packaged as a .vsix
│   ├── api/               # Azure Functions
│   └── bot/                # Teams Bot Framework bot — deferred to v2
└── docs/
    ├── design-logs/       # Immutable feature design snapshots
    ├── PRDs/               # Product requirements and implementation plans
    ├── refactor-plans/     # Refactor RFCs filed as work items
    ├── handoff/             # Panel layout spec + Adaptive Card JSON templates
    ├── ubiquitous-language.md
    └── dev-journal.md
```

---

## Running from Source

### Prerequisites

- Node.js 20+
- [Azure Functions Core Tools](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) (for `packages/api`)
- [`tfx-cli`](https://github.com/microsoft/tfs-cli) (for packaging `packages/extension` into a `.vsix`)

### Install

```
git clone https://github.com/carlos-rezai/PRSync.git
cd PRSync
npm install
```

This installs dependencies for all three packages via npm workspaces.

### Develop

```
npm run build --workspace=@prsync/extension --if-present
npm run start --workspace=@prsync/api
```

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

| Feature                                                   | Status           |
| --------------------------------------------------------- | ---------------- |
| Initial grill-me session (data model)                     | ✅ Complete      |
| Panel layout spec (in place of a Claude Design prototype) | ✅ Complete      |
| Adaptive Card templates                                   | ✅ Complete      |
| Monorepo scaffold                                         | ✅ Complete      |
| 1. Round Lifecycle (data + API)                           | ⬜ Not started   |
| 2. Extension Panel                                        | ⬜ Not started   |
| 3. Teams Notifications                                    | ⬜ Not started   |
| Round history view                                        | ⏸ Deferred       |
| Reminder notifications                                    | ⏸ Deferred       |
| Teams Bot Framework bot (interactive actions)             | ⏸ Deferred to v2 |

---

## Docs

- [Ubiquitous Language](docs/ubiquitous-language.md)
- [Panel Layout Spec](docs/handoff/panel-layout-spec.md)
- [Adaptive Card Templates](docs/handoff/adaptive-cards)
- [Dev Journal](docs/dev-journal.md)

---

## Author

**Carlos Rezai** — Senior Software Engineer, Berlin
Building structured human-AI workflows and fullstack AI-powered products.

[GitHub](https://github.com/carlos-rezai) [LinkedIn](https://www.linkedin.com/in/aryan-carlos-r-0ba21017b/)

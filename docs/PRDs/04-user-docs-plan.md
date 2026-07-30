# Plan: Documentation / User Manual

> Source PRD: https://github.com/carlos-rezai/PRSync/issues/26

Feature 4 of PRSync, and the first that ships no behaviour. Features
1–3 left a complete paper trail — three design logs, three PRDs, three
refactor plans, a dev journal, a 606-line `docs/deployment.md` and a
ubiquitous-language dictionary — every word of it written for whoever
_maintains_ PRSync. This feature writes the two documents for the people
who _use_ it: the **Operator** standing it up, and the **Teammate** who
gets a DM, or worse, who doesn't.

The hard part is not the prose. It is that PRSync's core terms are
precise and counter-intuitive, and friendly prose contradicts them by
default. **Done** is not ADO's Approve; a round closes on **quorum**,
not unanimity; **cancel** and **close** are both terminal but only one
notifies; the **reviewer list** is a snapshot that ignores later ADO
changes. The natural sentence — "when everyone's finished reviewing, the
round closes" — is not a loose paraphrase of quorum, it is a description
of a different product. That sentence has already shipped twice, in
`packages/bot/teams/manifest.json` and twice more in `README.md`.

So every phase ships a document _and_ the assertions that hold it to the
source it makes claims about. No phase leaves a document unguarded. The
prior art is exactly `packages/bot/src/test/deploymentDocs.test.ts`,
including its practice of recording in its own comments which assertions
are strong and which merely check that a section still exists.

Terminology follows `docs/ubiquitous-language.md` exactly, including its
new `## Documentation` section — **Operator**, **Teammate**, **Setup
guide**, **User guide**, **Deployment reference**, **Gloss**, **Derived
surface**. Full rationale, including the options rejected and why, is in
`docs/design-logs/04-user-docs.md` (Q1–Q11). Initiative name for
commits: `user-docs`.

## Architectural decisions

Durable decisions that apply across all phases:

- **Three documents, strict non-overlapping ownership.** The binding
  rule is that **no document restates what another owns**:

  | Document                      | Owns                          | Never contains                     |
  | ----------------------------- | ----------------------------- | ---------------------------------- |
  | `docs/setup-guide.md`         | _Sequence_ — eleven stages    | A setting value, a failure remedy  |
  | `docs/user-guide.md`          | _Use_ — and what PRSync does  | A term definition (it **glosses**) |
  | `docs/deployment.md`          | _Values, rationale, failures_ | Unchanged; gains back-links only   |
  | `docs/ubiquitous-language.md` | _Terminology_                 | Unchanged                          |

  Both of the "never contains" rules that are mechanically checkable are
  mechanically checked — assertion 2 for the setup guide, assertion 4
  for the user guide.

- **Authority and derived surfaces.** `docs/user-guide.md` is
  **authoritative** for what PRSync does. `README.md`, the Marketplace
  description in `packages/extension/vss-extension.json`, and
  `packages/bot/teams/manifest.json`'s `description.full` are **derived
  surfaces**: each may summarise, none may add a claim. The panel's own
  copy is not touched — this feature ships documentation.

- **Gloss, never define.** The user guide carries exactly one
  terminology section, "Five words PRSync uses precisely" (**Round**,
  **Done**, **Quorum**, **Cancel vs Close**, **Reviewer list**). Each
  entry is the canonical term _verbatim_, one plain sentence, and the
  counter-intuitive consequence. Those five then appear bolded and
  verbatim throughout the rest of the guide. A gloss that stops naming
  its canonical term has quietly become a second, competing definition —
  which is the exact failure the split exists to prevent, and assertion
  4 is the only place it is catchable.

- **Verification module** — one new file,
  `packages/bot/src/test/userDocs.test.ts`, sibling to
  `deploymentDocs.test.ts`, in the same package for the same reason: the
  precedent for a test in that package reading repo-root docs already
  exists, and adding a fourth workspace for one file is not worth a
  second vitest config. Its six assertions, and the phase each lands in:

  | #   | Assertion                                    | Strength   | Phase |
  | --- | -------------------------------------------- | ---------- | ----- |
  | 1   | Setup guide stages complete and in order     | Structural | 2     |
  | 2   | No setting tokens in the setup guide         | Structural | 2     |
  | 3   | Every relative link and `#anchor` resolves   | Strong     | 3     |
  | 4   | Glossed terms exist verbatim upstream        | Strong     | 1     |
  | 5   | No unanimity language on the two guides      | Strong     | 1     |
  | 6   | The same alias check on the derived surfaces | Strong     | 4     |

- **Shared markdown fixture.** `section()` and `readDoc()` — currently
  private to `deploymentDocs.test.ts` — are extracted into a fixture
  alongside `packages/bot/src/test/fixtures/sourceFiles.ts`, joined by
  the new heading and link resolvers. Same extraction, same reason,
  `sourceFiles.ts` itself was: a cross-layer test helper that a second
  test now needs. Fixtures live outside the layer conventions
  deliberately — every layer's tests consume them.

- **The alias scanner's scope is part of its contract.** It reads the
  two guides and the three derived surfaces. It explicitly does **not**
  read `docs/design-logs/`, `docs/PRDs/`, `docs/refactor-plans/`,
  `docs/dev-journal.md` or `docs/ubiquitous-language.md` — design logs
  are immutable snapshots and the language file's aliases-to-avoid
  columns exist precisely to name the superseded rule. Scanning them
  fails on day one, for the right words in the right places. It takes
  text plus an allowance for verbatim-quoted UI strings, so the guide
  can quote the "All reviewed" pill without failing the check it exists
  to satisfy.

- **The link resolver is the one genuinely deep module.** Given a set of
  markdown files it yields every unresolvable relative link or
  `#anchor`, behind an interface that does not change when a document is
  added. It must implement GitHub's heading slugification — lowercase,
  punctuation stripped, spaces to hyphens — not a naive
  lowercase-and-hyphen pass. `docs/deployment.md` contains headings
  where the two disagree (`## Why \`/api/messages\` is anonymous, and
  why that is not an open endpoint`), and that anchor is one the setup
  guide links to.

- **No screenshots**, in either document, and this is a non-decision
  recorded so it is not re-opened. There is no deployed environment to
  shoot from, the panel is dual-themed so any shot is wrong for half the
  readers, and a screenshot is a claim no test can check. The panel is
  described by role × state — the same decomposition
  `docs/handoff/panel-layout-spec.md` uses and the components implement
  — and the cards are quoted from `docs/handoff/adaptive-cards/`, which
  is already asserted against the builders.

- **`packages/api`, `packages/bot/src` and `packages/extension/src`
  behaviour is not touched by any phase.** The only source changes in
  this whole feature are the new test file, the shared fixture
  extraction, and two JSON description strings. If a phase finds itself
  wanting more, something has been mismodelled.

- **Testing posture.** Every assertion reads _two_ sources and fails
  when they disagree. None paraphrases a document back to itself, and
  none claims to check prose quality. Where an assertion is weak — where
  it only proves a section still exists — the test's own comment says so
  in as many words.

---

## Phase 1: The teammate's manual

**User stories**: 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
27, 28, 29, 30, 31, 32, 33, 34, 35, 43, 44 (guides), 47, 48

### What to build

`docs/user-guide.md`, end to end. The thinnest genuinely useful slice:
it is the document with no existing substitute anywhere in the repo, and
it stands alone without the setup guide existing.

Six sections, in this order:

1. **Install PRSync** — the **Teammate**'s two steps, first, so nobody
   has to read an operator's document to find their own install step.
   It says plainly that installing the Teams app is what makes a person
   **Reachable** at all: someone who never sideloaded it experiences
   literally nothing, and cannot distinguish that from "no round has
   opened".
2. **Five words PRSync uses precisely** — the gloss section. Canonical
   term verbatim, one plain sentence, and the counter-intuitive
   consequence: **Done** is not ADO's Approve and is yours alone, frozen
   once the round closes; **Quorum**, not unanimity, closes a round;
   **Cancel** and **Close** are both terminal but only close notifies;
   the **Reviewer list** is snapshotted at the click of Ready for
   review, so adding a reviewer in ADO afterwards changes nothing.
3. **What you'll see** — the panel by role × state: Author / Reviewer /
   Bystander against round-open / no-round-open, plus the loading, empty
   and failed-load states, since a reader hitting one needs to know it
   is a state and not a fault. A **Bystander** is told why the panel is
   read-only for them. Panel copy is quoted verbatim so a reader can
   match words on screen to words on the page — including the "All
   reviewed" status pill, which is glossed as _quorum met_ rather than
   changed.
4. **What arrives in Teams** — the two cards, quoted from
   `docs/handoff/adaptive-cards/`. States plainly that a duplicate DM is
   deliberate at-least-once delivery, not a fault.
5. **I didn't get a message** — a four-rung ladder: did you install the
   Teams app; was a round actually opened; were you on the snapshotted
   **Reviewer list**; ask whoever set PRSync up. The last rung is honest
   about ending there — only the **Operator** can read the notification
   log — and says so, because writing a more satisfying ending would
   mean claiming a capability that does not exist.
6. **Where the words come from** — one line pointing at
   `docs/ubiquitous-language.md` for the full definition.

Alongside it, the verification module opens. `section()` and `readDoc()`
move out of `deploymentDocs.test.ts` into the shared fixture, and
`deploymentDocs.test.ts` is re-pointed at them. That is a refactor: its
five deployment assertions and three project-instruction assertions must
remain byte-identical in intent and still pass. Any change in what it
catches is a defect in the extraction, not a finding.

Then `userDocs.test.ts` lands with its first two assertions — 4 (every
bolded term in the gloss section exists verbatim in
`docs/ubiquitous-language.md`) and 5 (no unanimity alias describes
closing anywhere in the guide, with the one quoted-pill allowance).

### Acceptance criteria

- [ ] `docs/user-guide.md` exists with the six sections in the stated
      order, the teammate's own two install steps first
- [ ] Each of the five glosses gives the canonical term verbatim, one
      plain sentence, and the counter-intuitive consequence
- [ ] The five terms appear bolded and verbatim wherever they are used
      elsewhere in the guide — the guide never paraphrases one into a
      second definition
- [ ] The panel is described by role × state, covering Author, Reviewer
      and Bystander against round-open and no-round-open, plus loading,
      empty and failed-load
- [ ] Panel copy quoted in the guide matches the strings the components
      actually render, and "All reviewed" is glossed as quorum met with
      the panel's copy left unchanged
- [ ] Both Adaptive Cards are quoted from `docs/handoff/adaptive-cards/`
- [ ] The at-least-once duplicate-DM behaviour is stated as deliberate
- [ ] "I didn't get a message" is a four-rung ladder ending honestly at
      the operator escalation, and says why that is where it ends
- [ ] `section()` and `readDoc()` live in a shared fixture beside
      `sourceFiles.ts`, and `deploymentDocs.test.ts` consumes them
- [ ] All eight of `deploymentDocs.test.ts`'s assertions still pass and
      still catch what they caught before the extraction
- [ ] Assertion 4 fails when a glossed term stops existing verbatim in
      `docs/ubiquitous-language.md`
- [ ] Assertion 5 fails on `unanimous`, `consensus`, `everyone`, `all
    reviewers`, `signed off` or `approved` describing a close, and
      passes on the verbatim-quoted "All reviewed" pill
- [ ] The test file's own comments state which assertions are strong and
      which are structural
- [ ] No file under `packages/api`, `packages/bot/src` (other than
      `src/test/`) or `packages/extension/src` is modified

---

## Phase 2: The operator's path

**User stories**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 40, 41, 47

### What to build

`docs/setup-guide.md` — the single ordered path from an empty Azure
subscription to a working PRSync, which does not exist anywhere in the
repo today. `docs/deployment.md` is organised by prerequisite: it states
what must be true, never what to do first, and the correct order is
derivable but wrong by default.

Eleven numbered stages, each ending in a positive check the operator can
actually run:

| Stage | Subject                                             |
| ----- | --------------------------------------------------- |
| 0     | Before you start — accounts, permissions, tools     |
| 1     | Storage — three tables and one queue                |
| 2     | Register the Azure Bot and its secret               |
| 3     | Deploy the bot Function App                         |
| 4     | Messaging endpoint and Teams channel                |
| 5     | Allow custom app upload in the tenant               |
| 6     | Package and sideload the Teams app — operator first |
| 7     | Deploy the API Function App                         |
| 8     | CORS                                                |
| 9     | Build, package, publish and install the extension   |
| 10    | End to end on a real PR                             |
| 11    | Roll out                                            |

Three orderings are load-bearing and are stated as such in the guide,
not merely implied by their position:

- **Stage 3 before stage 4** — the messaging endpoint needs a URL that
  exists. This dependency is currently buried as step 4 inside
  "Registering the Azure Bot resource".
- **Stage 6 before stage 7** — so stage 7's check has a **Reachable**
  recipient. Sideloading after the API deploy means the operator's first
  end-to-end attempt fails in the one place that looks like a code bug.
- **Stage 8 standing alone** rather than folded into stage 7 — CORS is
  the failure that yields a working-looking install with a dead panel,
  and a folded step is a skipped step.

Stage 7's check is the diagnostic centre of the guide: a hand-enqueued
queue message landing a real DM, proving stages 1–7 with no Azure
DevOps, no panel and no round involved. It reuses the recipe already in
`docs/deployment.md` rather than restating it.

Stage 0 tells the operator which accounts, permissions and tools they
need _before_ they start, so nobody gets four stages in and discovers
they are not a Teams tenant admin. Where a later step needs an authority
the reader may not hold — Azure, Teams tenant admin, ADO org owner —
that is called out inline rather than by splitting the guide into role
tracks: the sequence's entire value is being _one_ sequence. Stage 11
states plainly that each teammate must install the Teams app themselves
and that there is no bulk-install setting to go looking for, and hands
the operator exactly what to give the team — the zip and a link to the
user guide.

The guide names no setting value and no failure remedy. It says "set the
four bot settings" and links to the section of `docs/deployment.md` that
defines them; each stage carries one link to the relevant failure
symptoms. Local development is out, linked once from stage 0.

Assertions 1 and 2 land with it.

### Acceptance criteria

- [ ] `docs/setup-guide.md` exists with eleven numbered stages plus
      stage 0, each ending in a positive check
- [ ] Stage 0 lists the accounts, permissions and tools needed up front,
      and links once to local development in `docs/deployment.md`
- [ ] The three load-bearing orderings are stated explicitly as
      dependencies, with the reason each one matters
- [ ] Stage 7's check is the hand-enqueued queue message proving the
      whole notification path, linking to the existing recipe rather
      than restating it
- [ ] CORS is its own numbered stage
- [ ] Steps requiring an authority the reader may not hold are flagged
      inline; the guide is not split into role tracks
- [ ] Stage 11 states that each teammate installs the Teams app
      themselves, and hands over the zip and a link to the user guide
- [ ] No setting value and no failure remedy appears in the guide; each
      stage links to `docs/deployment.md` for both
- [ ] Assertion 1 fails when a stage heading is deleted or the stages
      stop ascending
- [ ] Assertion 2 fails when a `MICROSOFT_APP_*`, `AZURE_*`, `PRSYNC_*`
      or `VITE_*` token appears in the setup guide outside a link, and
      reuses the token pattern `deploymentDocs.test.ts` already defines
      rather than copying it
- [ ] Both assertions' comments record that they are structural
- [ ] `docs/deployment.md` is not restructured by this phase

---

## Phase 3: The links and the front door

**User stories**: 36, 37, 38, 39, 42

### What to build

The README becomes the front door that routes the three readers —
assessor, operator, teammate — to the right document in one click, and
the cross-referencing that replaces duplication gets the assertion that
keeps it from decaying into broken clicks.

`README.md` is restructured, not rewritten. "Why This Project Exists"
and the methodology framing stay **verbatim** — that is the portfolio
value, and it survives the restructure intact. Added: a Documentation
block routing the three readers. Updated: Build Status. Trimmed:
"Running from Source", which defers to the setup guide instead of
half-repeating it, so there is one install story.

The README's two unanimity sentences are corrected here, in the same
phase that restructures it — "authors get a personal DM the moment every
reviewer has finished" and "The moment every reviewer has toggled Done,
the round closes" both describe a close rule PRSync does not have. No
phase should end with a structurally-correct front door that still
contradicts the domain model on its first screen. The assertion that
forbids their return lands in Phase 4.

`docs/deployment.md` gains back-links to the setup guide, and nothing
else.

Assertion 3 lands: every relative link and `#anchor` in `README.md`,
`docs/setup-guide.md` and `docs/user-guide.md` resolves to a real file
and, where anchored, a real heading — including links into
`docs/deployment.md` and `docs/ubiquitous-language.md`. This is the
assertion that makes cross-referencing safe rather than fragile, and it
can only be written once all three documents exist. The link resolver's
GitHub slugification gets a direct test of its own — headings containing
backticks, slashes and em-dashes are exactly where a naive
implementation silently passes everything.

### Acceptance criteria

- [ ] `README.md` has a Documentation block routing assessor, operator
      and teammate to one document each
- [ ] "Why This Project Exists" and the methodology section are
      byte-identical to before the restructure
- [ ] Build Status reflects Feature 4
- [ ] "Running from Source" defers to `docs/setup-guide.md` rather than
      repeating any part of it
- [ ] Both README unanimity sentences are corrected to describe quorum
- [ ] `docs/deployment.md` gains back-links to the setup guide and no
      other change
- [ ] Assertion 3 fails on a relative link to a missing file, and on an
      `#anchor` that matches no heading in the target document
- [ ] The slugifier is directly tested against headings containing
      backticks, slashes and em-dashes, including
      `docs/deployment.md`'s `/api/messages` heading that the setup
      guide links to
- [ ] The link resolver's interface does not need to change when a
      document is added to the set

---

## Phase 4: The derived surfaces

**User stories**: 44 (derived surfaces), 45, 46, 47

### What to build

The three surfaces where the contradiction has actually shipped are
corrected, and the check that forbids its return is extended to cover
them.

- `packages/bot/teams/manifest.json`'s `description.full` — "when the
  last reviewer marks themselves done and the round closes" is corrected
  to quorum. This is the sentence every person installing the Teams app
  reads.
- `packages/extension/vss-extension.json`'s `description` is reduced to
  a summary plus a pointer to the user guide.
- The README's sentences were already corrected in Phase 3; this phase
  adds the assertion that keeps them corrected.

Assertion 6 extends the alias scanner to `manifest.json`'s
`description.full`, `README.md`, and `vss-extension.json`'s
`description`. It reads JSON as JSON — the check is against the field's
value, not the file's raw text, so reformatting the manifest cannot
break it and a stray comment cannot trip it.

The scanner's exclusions are load-bearing and asserted as part of this
phase, not left implicit: `docs/design-logs/`, `docs/PRDs/`,
`docs/refactor-plans/`, `docs/dev-journal.md` and
`docs/ubiquitous-language.md` are never read by assertions 5 or 6.
Design logs are immutable snapshots and the language file's
aliases-to-avoid columns and flagged-ambiguities section exist precisely
to name the superseded rule; scanning them fails on day one, for the
right words in the right places.

This is the phase that closes the feature, so it is also where the whole
documentation set is read once as a set: the four documents now
cross-reference each other and a reader will click between them, which
is the accepted cost of not duplicating.

### Acceptance criteria

- [ ] `packages/bot/teams/manifest.json`'s `description.full` describes
      quorum, not the last reviewer, and the manifest still validates
      against the packaging test
- [ ] `packages/extension/vss-extension.json`'s `description` is a
      summary plus a pointer to the user guide, adding no claim the user
      guide does not make
- [ ] Assertion 6 reads the manifest and `vss-extension.json` as JSON
      and scans the specific description fields, plus `README.md`
- [ ] Assertion 6 fails when a unanimity alias describing a close is
      reintroduced to any of the three surfaces
- [ ] Assertions 5 and 6 never read `docs/design-logs/`, `docs/PRDs/`,
      `docs/refactor-plans/`, `docs/dev-journal.md` or
      `docs/ubiquitous-language.md`, and that exclusion is asserted
      rather than merely arranged
- [ ] All six assertions of `userDocs.test.ts` pass together, and its
      header comment records honestly which are strong and which are
      structural
- [ ] The full monorepo suite is green — bot, api and extension — and
      lint, typecheck and the pre-commit gate pass
- [ ] No behaviour change anywhere: the only source changes across all
      four phases are `userDocs.test.ts`, the shared fixture extraction,
      `deploymentDocs.test.ts`'s re-pointing, and two JSON description
      strings

## Problem Statement

PRSync is complete and undocumented for anyone who has to touch it.

Features 1–3 shipped with a full paper trail — three design logs, three
PRDs, three refactor plans, a dev journal, a 606-line
`docs/deployment.md`, and a ubiquitous-language dictionary. Every word of
it is written for whoever _maintains_ PRSync. Nothing is written for
whoever _uses_ it.

Two readers are stranded.

**The operator standing PRSync up for the first time.**
`docs/deployment.md` is organised by prerequisite, not by order of
operations: it states what must be true, never what to do first. The
correct sequence is derivable but wrong by default. The bot Function App
must exist before its messaging endpoint can point anywhere, and that
dependency is buried as step 4 inside "Registering the Azure Bot
resource". Nothing says the Teams app should be sideloaded before the API
is worth testing — so the operator's first end-to-end attempt has no
reachable recipient and fails in the one place that looks like a code
bug. There is no ordered path from an empty Azure subscription to a
working PRSync anywhere in the repo.

**The teammate who gets a DM — or, worse, who doesn't.**
**Unreachable** is a logged fact the panel does not surface. A person who
never sideloaded the bot experiences _literally nothing_, and cannot
distinguish that from "no round has opened". Their only recourse is to
ask someone, and there is no document to hand them. A person who _does_
get a DM has nothing explaining why a round closed while they were still
reading it.

Underneath both sits a harder problem: **PRSync's core terms are precise
and counter-intuitive, and friendly prose contradicts them by default.**
**Done** is not ADO's Approve. A round closes on **quorum**, not
unanimity. **Cancel** and **close** are both terminal but only one
notifies. The **reviewer list** is a snapshot that deliberately ignores
later ADO changes. The natural sentence — "when everyone's finished
reviewing, the round closes" — is not a loose paraphrase of quorum, it is
a description of a different product.

This is not hypothetical. It has already happened, twice, on surfaces
that ship:

- `packages/bot/teams/manifest.json` tells every person installing the
  Teams app that the author hears back _"when the last reviewer marks
  themselves done"_.
- `README.md` says it twice — _"authors get a personal DM the moment
  every reviewer has finished"_ and _"The moment every reviewer has
  toggled Done, the round closes"_.

Four user-facing surfaces exist today (README, the Marketplace
description in `vss-extension.json`, the Teams manifest's description,
and the panel's own copy), each independently editable, none
authoritative, and two already contradicting the domain. Writing a manual
without settling which one is authoritative just produces a fifth copy to
drift.

## Solution

Three documents with strict, non-overlapping ownership, plus one test
that keeps them from swapping jobs.

- **`docs/setup-guide.md` owns _sequence_.** Eleven numbered stages from
  nothing to a working PRSync, each ending in a positive check. It names
  no setting value and no failure remedy — it says "set the four bot
  settings" and links to the reference.
- **`docs/user-guide.md` owns _use_.** The teammate's manual, and the
  authoritative statement of what PRSync does. Install, the five precise
  words, what the panel shows by role and state, what arrives in Teams,
  and what to do when nothing does.
- **`docs/deployment.md` keeps owning _values, rationale and failures_.**
  Unchanged except for back-links. It stays the thing you look things up
  in, which is what it is already good at.

`README.md` becomes the front door that routes the three readers to the
right one.

The binding rule is that **no document restates what another owns**. The
setup guide naming a setting value is the duplication that rots; so is
the user guide defining a term that `docs/ubiquitous-language.md`
defines. Both are mechanically checked.

Against the terminology problem, the rule is **gloss, never define**. The
user guide carries one section — "Five words PRSync uses precisely"
(Round, Done, Quorum, Cancel vs Close, Reviewer list) — where each entry
is the canonical term _verbatim_, one plain sentence, and the
counter-intuitive consequence. Those terms then appear bolded and
verbatim everywhere else in the guide. A gloss that stops naming its
canonical term has become a second, competing definition, which is
exactly the failure the split exists to prevent.

`docs/user-guide.md` is declared authoritative for behaviour. Every other
user-facing surface — README, Marketplace description, Teams manifest —
is a **derived surface**: it may summarise, it may never add a claim.
Falling straight out of that: the manifest's unanimity sentence and the
README's two are corrected, and a test forbids their return.

Verification follows the model this repo already uses for docs —
`packages/bot/src/test/deploymentDocs.test.ts`, which reads source and
documentation together and fails when they disagree. A sibling
`userDocs.test.ts` asserts six mechanical facts about the new documents,
and is honest in its own comments about which of them are strong and
which merely check that a section still exists.

No screenshots, in either document. There is no deployed environment to
shoot from, the panel is dual-themed so any shot is wrong for half the
readers, and a screenshot is a claim no test can check. The panel is
described by role × state — the same decomposition
`docs/handoff/panel-layout-spec.md` uses and the components implement —
and the cards are quoted from the frozen `docs/handoff/adaptive-cards/`
JSON, which is already test-asserted.

## User Stories

**The operator standing PRSync up**

1. As an operator, I want a single ordered path from an empty Azure
   subscription to a working PRSync, so that I never have to derive the
   order from a document organised by prerequisite.
2. As an operator, I want each stage to end in a positive check I can
   run, so that I find out a stage failed at that stage rather than three
   stages later.
3. As an operator, I want stage 0 to tell me which accounts, permissions
   and tools I need before I start, so that I do not get four stages in
   and discover I am not a Teams tenant admin.
4. As an operator, I want to be told inline when a step needs someone
   else's authority (Azure, Teams tenant admin, ADO org owner), so that I
   can go and ask for it before I am blocked.
5. As an operator, I want the guide to link to the value I need rather
   than printing it, so that when a setting is renamed there is exactly
   one place it changes.
6. As an operator, I want to deploy the bot Function App before I
   configure its messaging endpoint, so that I am not pasting a URL for
   an app that does not exist yet.
7. As an operator, I want to sideload the Teams app _before_ I deploy the
   API, so that the first end-to-end check has a reachable recipient and
   a failure means something.
8. As an operator, I want a checkpoint that proves the whole notification
   path — storage, queue, bot, Teams identity, card, DM — using a
   hand-enqueued message, so that I have isolated it before Azure DevOps,
   the panel or a round exist to confuse the diagnosis.
9. As an operator, I want CORS to be its own numbered stage, so that it
   does not get folded into the API deploy and skipped, leaving me a
   working-looking install with a dead panel.
10. As an operator, I want the final stage to hand me exactly what to
    give my team (the zip and a link to the user guide), so that rollout
    is not a thing I have to invent.
11. As an operator, I want to be told plainly that each teammate must
    install the Teams app themselves and that I cannot do it for them, so
    that I do not spend an afternoon looking for the bulk-install setting.
12. As an operator, I want failures to stay in `docs/deployment.md` with
    one link per stage, so that I read a short sequence when things work
    and a symptom table when they do not.
13. As an operator, I want local development left out of the setup guide
    and linked once, so that every stage does not double in length for a
    path I am not on.

**The teammate using PRSync**

14. As a teammate, I want the first section of the user guide to be the
    two things I personally have to do, so that I am not reading an
    operator's document to find my own install step.
15. As a teammate, I want to know that installing the Teams app is what
    makes me reachable at all, so that I understand why nothing has ever
    arrived.
16. As a teammate, I want a plain sentence for each of the five precise
    words, so that I can use PRSync without reading a domain dictionary.
17. As a teammate, I want each of those words to carry its
    counter-intuitive consequence, so that I learn the surprising half
    rather than the half I already assumed.
18. As a reviewer, I want to know that **Done** is not Azure DevOps's
    Approve, so that I do not think clicking one has done the other.
19. As a reviewer, I want to know my **Done** is mine alone and freezes
    when the round closes, so that a checkbox I cannot click is not a bug
    report.
20. As an author, I want to know a round closes on **quorum** rather than
    unanimity, so that a round closing before the third reviewer looked
    is understood as the design and not a lost review.
21. As an author, I want to know that **cancel** and **close** are both
    terminal but only close notifies, so that I do not cancel a round
    expecting my reviewers to hear about it.
22. As an author, I want to know the **reviewer list** is snapshotted at
    the moment I click Ready for review, so that I understand why adding
    a reviewer in ADO afterwards changes nothing.
23. As an author, I want to know that a stuck round — one whose quorum
    can no longer be reached — is solved by cancelling and opening a new
    one, so that I have the recovery move.
24. As a teammate, I want the panel described by my role and the round's
    state, so that I can find the row that matches what I am actually
    looking at.
25. As a bystander, I want to know why the panel is read-only for me, so
    that I do not think it is broken or that I lack a permission.
26. As a teammate, I want to see what the two Teams cards actually say,
    so that I recognise one when it arrives.
27. As a teammate, I want to know a duplicate DM is deliberate
    at-least-once delivery rather than a bug, so that I do not report it
    and do not distrust the next one.
28. As a teammate, I want the guide to explain the status pill's "All
    reviewed" as _quorum met_, so that the one piece of unanimity-shaped
    wording still on screen does not undo the quorum gloss.
29. As a teammate, I want one line pointing at
    `docs/ubiquitous-language.md`, so that I can get the full definition
    if the gloss is not enough.

**The teammate who got no message**

30. As a teammate who got no DM, I want a section addressed exactly to
    that, so that I have something to read instead of someone to
    interrupt.
31. As a teammate who got no DM, I want the first question to be whether
    I ever installed the Teams app, so that the most common cause is
    ruled out first and I can fix it myself.
32. As a teammate who got no DM, I want to be able to check whether a
    round was ever opened, so that I can tell "nothing happened" apart
    from "something happened and missed me".
33. As a teammate who got no DM, I want to know that being on a PR in
    Azure DevOps is not the same as being on a round's snapshotted
    reviewer list, so that I understand how I can be a reviewer and still
    not be notified.
34. As a teammate who got no DM, I want the ladder to end honestly at
    "ask whoever set PRSync up" rather than trailing off, so that I know
    the next step exists even though I cannot take it.
35. As an operator receiving that escalation, I want to be told that I am
    the only person who can read the notification log, so that I know the
    escalation is legitimately mine and where to look.

**Anyone assessing the project**

36. As someone assessing PRSync, I want the README to route me in one
    click to the right document for who I am, so that I do not read an
    eleven-stage Azure setup to find out what the product does.
37. As someone assessing PRSync, I want the README to keep its "Why This
    Project Exists" and methodology framing, so that the portfolio value
    survives the restructure.
38. As someone assessing PRSync, I want the README's description of how
    it works to agree with the product, so that the first paragraph I
    read is not the one that contradicts the domain model.
39. As someone assessing PRSync, I want "Running from Source" to defer to
    the setup guide rather than half-repeating it, so that there is one
    install story.

**The maintainer**

40. As a maintainer, I want a test that fails when a setup stage is
    deleted or reordered, so that the sequence cannot silently lose the
    dependency it exists to encode.
41. As a maintainer, I want a test that fails when the setup guide starts
    naming setting values, so that the no-duplication rule is enforced
    rather than merely agreed.
42. As a maintainer, I want every relative link and anchor across the
    documentation set to be checked, so that the cross-referencing that
    replaces duplication does not decay into broken clicks.
43. As a maintainer, I want a test that fails when a glossed term stops
    existing verbatim in `docs/ubiquitous-language.md`, so that renaming
    a concept goes red instead of quietly producing two dialects.
44. As a maintainer, I want a test that fails when unanimity language
    describes closing anywhere on a user-facing surface, so that the
    contradiction that has already shipped twice cannot ship a third
    time.
45. As a maintainer, I want that check to cover the derived surfaces as
    well as the guides — the Teams manifest, the README and the
    Marketplace description — because that is where it has actually
    happened.
46. As a maintainer, I want the alias check to _not_ read the design
    logs, PRDs or `docs/ubiquitous-language.md`, so that documents that
    legitimately discuss the superseded unanimity rule do not fail it.
47. As a maintainer, I want the test's own comments to be honest about
    which assertions are mechanical and which merely check that a section
    exists, so that nobody reads a structural check as a prose-quality
    guarantee.
48. As a maintainer, I want the markdown-reading helpers shared with
    `deploymentDocs.test.ts` rather than copied, so that the second docs
    test does not fork the first.

## Implementation Decisions

**Document ownership**

- Three documents, strict ownership, no overlap: `docs/setup-guide.md`
  owns sequence; `docs/user-guide.md` owns use and behaviour;
  `docs/deployment.md` continues to own values, rationale and failures.
  `docs/ubiquitous-language.md` continues to own terminology.
- `docs/user-guide.md` is **authoritative** for what PRSync does. The
  README, the Marketplace description and the Teams manifest description
  are **derived surfaces**: they may summarise, they may never add a
  claim.
- The setup guide names no setting value and no failure remedy. It refers
  to settings by group ("the four bot settings") and links to the section
  of `docs/deployment.md` that defines them.
- `docs/deployment.md` is not restructured. It gains back-links to the
  setup guide and nothing else.
- README is restructured, not rewritten: "Why This Project Exists" and
  the methodology section stay verbatim; a Documentation block routing
  the three readers is added; Build Status is updated; "Running from
  Source" is trimmed to defer to the setup guide.

**The setup guide's eleven stages**

- Eleven numbered stages, each ending in a positive check: (0) before you
  start, (1) storage — three tables and one queue, (2) register the Azure
  Bot and its secret, (3) deploy the bot Function App, (4) messaging
  endpoint and Teams channel, (5) allow custom app upload in the tenant,
  (6) package and sideload the Teams app, operator first, (7) deploy the
  API Function App, (8) CORS, (9) build, package, publish and install the
  extension, (10) end to end on a real PR, (11) roll out.
- Three orderings are load-bearing and must be stated as such: stage 3
  before stage 4 (the endpoint needs a URL that exists); stage 6 before
  stage 7 (so stage 7's check has a reachable recipient); and stage 8
  standing alone rather than folded into stage 7 (CORS is the failure
  that yields a working-looking install with a dead panel).
- Stage 7's check is the diagnostic centre of the guide: a hand-enqueued
  queue message landing a real DM, proving stages 1–7 with no Azure
  DevOps, no panel and no round involved. It reuses the recipe already in
  `docs/deployment.md` rather than restating it.
- Where a step needs an authority the reader may not hold, that is called
  out inline rather than by splitting the guide into role tracks — the
  sequence's entire value is being one sequence.
- Local development is out. Linked once from stage 0, and stays in
  `docs/deployment.md`.

**The user guide's shape**

- Six sections, in this order: Install PRSync (the teammate's two steps);
  Five words PRSync uses precisely; What you'll see (panel by role ×
  state); What arrives in Teams (the two cards); I didn't get a message;
  Where the words come from.
- "Five words PRSync uses precisely" glosses **Round**, **Done**,
  **Quorum**, **Cancel vs Close** and **Reviewer list**. Each entry is
  the canonical term verbatim, one plain sentence, and the
  counter-intuitive consequence. Those five appear bolded and verbatim
  throughout the rest of the guide.
- The panel is described by role × state — Author / Reviewer / Bystander
  against round-open / no-round-open — matching
  `docs/handoff/panel-layout-spec.md` and the components that implement
  it. Loading, empty and failed-load states are described too, since a
  reader hitting one needs to know it is a state and not a fault.
- The panel's copy is quoted verbatim where the guide describes it, so
  the reader can match words on screen to words on the page.
- The status pill reads "All reviewed" when a round closes. The panel's
  copy is **not changed** — this feature ships documentation. The guide
  quotes that string and glosses it: it means the quorum was met, not
  that everyone reviewed. The alias check must permit that one quoted
  phrase.
- The two cards are quoted from `docs/handoff/adaptive-cards/`, which is
  already asserted against the builders.
- "I didn't get a message" is a four-rung ladder: did you install the
  Teams app; was a round actually opened; were you on the snapshotted
  reviewer list; ask whoever set PRSync up. The last rung is honest about
  ending there — only the operator can read the notification log.
- The guide states plainly that a duplicate DM is deliberate
  at-least-once delivery, not a fault.

**Derived-surface corrections**

- `packages/bot/teams/manifest.json`'s `description.full`: the "when the
  last reviewer marks themselves done" sentence is corrected to quorum.
- `README.md`: both unanimity sentences ("the moment every reviewer has
  finished", "The moment every reviewer has toggled Done, the round
  closes") are corrected. This is an addition to the design log's file
  list, made because the README carries the identical defect the manifest
  does.
- `packages/extension/vss-extension.json`'s `description` is reduced to a
  summary plus a pointer.
- The panel's own copy is untouched. There is no help affordance in v1
  and adding one is product code this feature does not write.

**Verification module**

- One new test file, `packages/bot/src/test/userDocs.test.ts`, sibling to
  `deploymentDocs.test.ts`, in the same package for the same reason: the
  precedent for a test in that package reading repo-root docs already
  exists, and adding a fourth workspace for one file is not worth a
  second vitest config.
- The markdown helpers currently private to `deploymentDocs.test.ts` —
  `section()` and `readDoc()` — are extracted into a shared fixture
  alongside `sourceFiles.ts`, joined by the new heading and link
  resolvers. This is the same extraction, for the same reason,
  `sourceFiles.ts` itself was: a cross-layer test helper that a second
  test now needs. `deploymentDocs.test.ts` is updated to consume it,
  which is a refactor with no behaviour change and no assertion change.
- The link resolver is the one genuinely deep module here: given a set of
  markdown files it yields every unresolvable relative link or `#anchor`,
  behind an interface that does not change when a document is added. It
  must implement GitHub's heading slugification (lowercase, punctuation
  stripped, spaces to hyphens) rather than a naive lowercase-and-hyphen
  pass — `docs/deployment.md` contains headings with backticks and
  slashes (`## Why \`/api/messages\` is anonymous…`) where the two
  disagree, and that anchor is one the setup guide links to.
- The alias scanner takes text plus an allowance for verbatim-quoted UI
  strings, so that the guide can quote "All reviewed" without failing the
  check it exists to satisfy.

**Non-decisions, recorded so they are not re-opened**

- No screenshots, in either document. If ever added: `docs/images/`, dark
  theme only, and never of a state no test covers.
- The four documents now cross-reference each other and a reader will
  click between them. That is the accepted cost of not duplicating; the
  link assertion is what keeps it paid.

## Testing Decisions

**What a good test is here.** This slice ships documentation, so there is
no behaviour to drive. What exists — and what rots silently — is the
agreement between a document and the thing it makes claims about. Every
assertion reads two sources and fails when they disagree; none of them
paraphrase a document back to itself, and none claim to check prose
quality. The prior art is exactly `deploymentDocs.test.ts`, including its
practice of recording in comments which of its own assertions are weak.

**The six assertions in `userDocs.test.ts`:**

1. **Stage completeness and order.** The setup guide's numbered stage
   headings are all present and in ascending order. Catches a stage
   silently deleted or reordered — which is how the sequence loses the
   dependency it exists to encode. _Structural._
2. **No setting values in the setup guide.** No `MICROSOFT_APP_*`,
   `AZURE_*`, `PRSYNC_*` or `VITE_*` token appears in the setup guide
   except inside a link. Catches the no-duplication rule breaking, which
   is how the setup guide becomes a second `deployment.md`. _Structural._
   The token pattern is the one `deploymentDocs.test.ts` already uses,
   which is why it is being shared rather than copied.
3. **Every link resolves.** Every relative link and `#anchor` in
   `README.md`, `docs/setup-guide.md` and `docs/user-guide.md` resolves
   to a real file and, where anchored, a real heading — including links
   into `docs/deployment.md` and `docs/ubiquitous-language.md`. This is
   the assertion that makes cross-referencing safe instead of fragile.
   _Strong._
4. **Glossed terms exist verbatim upstream.** Every bolded term in "Five
   words PRSync uses precisely" appears verbatim in
   `docs/ubiquitous-language.md`. Catches a renamed concept diverging,
   and enforces gloss-not-define at the only point it is mechanically
   checkable. _Strong._
5. **No unanimity language on the guides.** No unanimity alias
   (`unanimous`, `consensus`, `everyone`, `all reviewers`, `signed off`,
   `approved`) describes closing, in either new guide. _Strong, and
   deliberately blunt_ — it will occasionally require rephrasing a
   sentence that was not actually wrong. The one exception is the
   verbatim-quoted "All reviewed" pill copy.
6. **The same check on the derived surfaces.** The alias check also reads
   `packages/bot/teams/manifest.json`'s `description.full`, `README.md`,
   and `packages/extension/vss-extension.json`'s `description` — the
   three surfaces where the contradiction has actually shipped. _Strong._

**Explicitly not scanned** by assertions 5 and 6: `docs/design-logs/`,
`docs/PRDs/`, `docs/refactor-plans/`, `docs/dev-journal.md` and
`docs/ubiquitous-language.md`. Design logs are immutable snapshots and
the language file's aliases-to-avoid columns and flagged-ambiguities
section exist precisely to name the superseded rule. Scanning them fails
on day one, for the right words in the right places.

**Modules under test.** The shared markdown fixture is exercised through
the assertions rather than tested in isolation, matching how
`sourceFiles.ts` is treated — with one exception: the link resolver's
slugification is worth a direct test, because GitHub's rules for
headings containing backticks, slashes and em-dashes are where a naive
implementation silently passes everything.

**Regression surface.** `deploymentDocs.test.ts` is edited to consume the
extracted helpers. Its five assertions and three
project-instruction assertions must remain byte-identical in intent and
still pass — the extraction is a refactor, and any change in what it
catches is a defect in the extraction.

## Out of Scope

- **In-panel help.** The panel has no help affordance; adding one is
  product code. Its existing copy is what the manual is written to match.
- **Changing the panel's copy**, including the "All reviewed" status
  pill. The guide glosses it instead.
- **Screenshots**, in either document.
- **Local development in the setup guide.** It stays in
  `docs/deployment.md` and is linked once.
- **Restructuring `docs/deployment.md`.** It gains back-links only.
- **Authoring the published Marketplace long-description page.**
  `vss-extension.json`'s `description` field is in scope; the Marketplace
  listing itself is not, since nothing is published.
- **Real `privacyUrl` / `termsOfUseUrl` pages.** Both still point at the
  repository. They are needed before PRSync goes beyond sideloading in
  one tenant, and that is not a documentation task.
- **Surfacing Unreachable in the panel.** It would turn rung four of the
  ladder from an escalation into a self-service answer, but it needs an
  API read path and panel state, neither of which is modelled.
- **A channel or group-chat surface.** The Teams app package is personal
  scope only.
- **Any change to `packages/api`, `packages/bot/src` or
  `packages/extension/src` behaviour.** The only source changes are the
  new test, the shared fixture extraction, and two JSON description
  strings.

## Further Notes

- The implementation order is deliberately thinnest-useful-first: (1) the
  user guide plus assertions 4 and 5, because it is the document with no
  existing substitute anywhere in the repo and it stands alone without
  the setup guide existing; (2) the setup guide plus assertions 1 and 2;
  (3) the README, the back-links and assertion 3, which can only be
  written once all three documents exist; (4) the derived-surface
  corrections and assertion 6.
- The README's unanimity sentences are an addition to the design log's
  file list, found while verifying it against the repo. The design log
  flagged only the manifest. The same defect, on the most-read surface in
  the project, on the strength of the same rule — a derived surface may
  summarise, never claim.
- **Gloss and definition are different jobs.** `ubiquitous-language.md`
  defines; the user guide glosses. A gloss that stops naming its
  canonical term verbatim has quietly become a second definition, and
  assertion 4 is the only place that is catchable.
- **Unanimity language is drift, not phrasing.** "When everyone has
  finished", "all reviewers", "signed off", "consensus" and "the last
  reviewer" all describe a close rule PRSync does not have. This is why
  assertion 5 is a blunt keyword check rather than something subtler: the
  failure mode is a natural, fluent, wrong sentence, and fluency is not
  what distinguishes it.
- **Operator is not a round role.** Author, Reviewer and Bystander are
  resolved against a round; Operator is resolved against a deployment and
  appears in no round, no panel and no notification. The same person is
  usually both, which is exactly why the two vocabularies must not be
  traded between the two guides.
- The four-rung ladder ending at "ask whoever set PRSync up" is honest
  rather than satisfying, and stays true until Unreachable is surfaced in
  the panel. Writing a more satisfying ending would mean claiming a
  capability that does not exist.
- Stage 7's hand-enqueued check is worth protecting in review. It is the
  single most diagnostic moment in the sequence — the only point where
  the entire notification path can fail in isolation, before Azure
  DevOps, the panel or a round exist to widen the search.
- Vocabulary for this feature (**Operator**, **Teammate**, **Setup
  guide**, **User guide**, **Deployment reference**, **Gloss**, **Derived
  surface**) was added to `docs/ubiquitous-language.md` by the same
  grill-me session. It is the first section of that file describing no
  runtime concept.
- Full design rationale, including the options rejected and why, is in
  `docs/design-logs/04-user-docs.md` (Q1–Q11). Initiative name for
  commits: `user-docs`.

# PRSync — User guide

PRSync sits on an Azure DevOps pull request and does one thing: it tells
the people involved when a round of review starts and when it finishes.
If you are reviewing a pull request, you get a direct message in Teams
the moment the author asks for a review. If it is your pull request, you
get one message when the review round is finished — which is the signal
that it is safe to regenerate the implementation from the refined use
case.

This guide is written for the person who has to live with PRSync, and it
is the authoritative description of what PRSync does. The README, the
Marketplace listing and the Teams app description are short summaries of
this page; where one of them says something this page does not, this page
is the one to believe.

## Install PRSync

Two steps. The first is yours alone — nobody can do it on your behalf,
including whoever set PRSync up for your organisation.

### 1. Add the PRSync app to Teams

Ask whoever set PRSync up for `prsync-teams.zip`. One file serves the
whole team; it carries nothing specific to you.

1. In Teams, go to "Apps" → "Manage your apps" → "Upload an app" →
   "Upload a custom app".
2. Select `prsync-teams.zip` and choose "Add".

Adding the app is the only thing that makes you **Reachable**, and it is
what this whole guide depends on. Until you have done it PRSync cannot
open a chat with you, so you are **Unreachable** and it has nowhere to
send anything. Nothing warns you about this. You get no error, no banner
and no failed-delivery notice; rounds
open and close normally and you are simply never told. Nothing appears
either way, so you cannot tell "I never added the app" apart from "no
round has opened yet" — which is exactly why this step is first.

To confirm it worked, send the PRSync chat any message at all. It replies
starting with "PRSync is connected." That reply is the only confirmation
you will ever get, because every other message PRSync sends arrives
unprompted.

If you later remove the app, PRSync forgets you again and stops
messaging you.

### 2. Find the PRSync tab on a pull request

There is nothing to install on the Azure DevOps side. The extension is
installed once for the whole organisation, so open any pull request and
look for the "PRSync" tab alongside Overview, Files and Commits.

If the tab is not there, it is not something you can fix from your own
account — ask whoever set PRSync up.

## Five words PRSync uses precisely

These five words mean something narrower than they usually do, and three
of them describe behaviour that surprises people the first time. What
follows is a plain-language gloss of each, not its definition: the
definitions live in [`ubiquitous-language.md`](ubiquitous-language.md),
and where that file and this one disagree, that file is right.

**Round** — one cycle of review on a pull request, opened by the author
clicking "Ready for review" and ending either closed or **Cancelled**.
_The consequence:_ a pull request has many **Round**s over
its life, and PRSync talks about the current one, never about the pull
request as a whole. Reviewing a pull request twice is two **Round**s, not
one long one.

**Done** — a per-person checkbox meaning "I have finished my pass on this
**Round**". _The consequence:_ it is not Azure DevOps's own Approve vote.
Ticking one does not tick the other, and PRSync does not read your
Approve. It is also yours alone — you can tick only your own box, and it
freezes the moment the **Round** ends, whether or not you got to it.

**Quorum** — the number of **Done** ticks it takes to finish a **Round**,
a configured count that is two by default. _The consequence:_ a **Round**
can finish while people on its **Reviewer list** have not looked at the
pull request at all. Their **Done** box simply freezes unticked. If you
are the third reviewer on a two-**Quorum** round, the round can be over
before you open it.

**Cancel round** — the author's action that abandons an open **Round**,
leaving it **Cancelled**. _The consequence:_ **Cancelled** and **Round
closed** are both final, but only **Round closed** sends the author the
"safe to proceed" message. A cancelled round messages nobody, which means
silence after a round disappears is the expected outcome and not a
delivery problem.

**Reviewer list** — the set of people PRSync tracks for a **Round**,
copied from the pull request's reviewers at the instant the author
clicked "Ready for review". _The consequence:_ it is a snapshot, and
PRSync never re-reads it. Adding or removing a reviewer in Azure DevOps
after a **Round** has opened changes nothing about that round — the
person added is not messaged and cannot tick **Done**. The way to pick up
a reviewer change is **Cancel round** followed by a new one.

## What you'll see

The panel is a tab on the pull request page. What it shows you depends on
two things: which role you hold for the current **Round**, and whether a
**Round** is open.

Roles are decided per **Round**, not per account. You are the **Author**
of your own pull requests, a **Reviewer** on the ones where you were on
the **Reviewer list** when the round opened, and a **Bystander**
everywhere else. The same person is all three during a normal week.

|               | No **Round** open                                                       | **Round** open                                                    |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Author**    | The form for starting the next **Round** replaces the rest of the panel | Label editable, "Cancel round" available, reviewer rows read-only |
| **Reviewer**  | The finished **Round** frozen, or "No round yet"                        | Your own **Done** checkbox is live; every other row is read-only  |
| **Bystander** | "No round yet"                                                          | The whole panel, read-only                                        |

### If it is your pull request (**Author**)

With no **Round** open, the panel is replaced by the form for starting
the next one: the line "No open round. Start one when the PR is ready for
review.", a "Round label" field pre-filled with the round number and
phase, two phase buttons — "Use Case Review" and "Implementation Review"
— and the "Ready for review" button. Clicking it is what opens the
**Round**, snapshots the **Reviewer list** and sends the DMs.

If the pull request has nobody PRSync can track, the button is disabled
and the panel says "Add an eligible reviewer to this PR in Azure DevOps
before opening a round." PRSync tracks individual people; a team or group
added as a reviewer does not count, and you are never a reviewer of your
own pull request.

While a **Round** is open you can rename it — the label is an editable
field, and the new name is used by messages sent after the change — and
you can end it with "Cancel round". That button asks first: a dialog
titled "Cancel round?" saying "This round is abandoned and its reviewers
are not notified. You can open a new round straight afterwards.", with
"Keep round" and "Cancel round". The reviewer rows are read-only for you,
because the author is never on their own round's **Reviewer list**.

### If you are on the **Reviewer list** (**Reviewer**)

Your own row's checkbox is the one control that is live for you, and only
while the **Round** is open. The other rows show the same information
read-only — you can see who has ticked **Done**, and you cannot tick it
for them.

Below the list, a pill counts progress: "1 of 3 reviewed" while the
**Round** is open. When the count reaches the **Quorum** the **Round**
finishes and the pill becomes "All reviewed". Read that pill as _quorum
met_ — it appears as soon as the **Quorum** is reached, which may be
before each person on the **Reviewer list** has ticked **Done**. A
cancelled round shows "Cancelled" instead.

Once the **Round** is over, every checkbox freezes, including yours.
There is no un-ticking and no late ticking; the next **Round** starts
fresh.

### If you are neither (**Bystander**)

You see the same round the other two see, entirely read-only, and this is
the normal state rather than a permissions failure. PRSync makes a
control live only for the person it belongs to: the label and "Cancel
round" belong to the **Author**, and a **Done** checkbox belongs to the
one person it names. As a **Bystander** you are not the **Author** of
this pull request and you were not on the **Reviewer list** when the
**Round** opened, so there is nothing here that could be yours to click.

If you expected to be a **Reviewer** on this round, "I didn't get a
message" below covers why you might not be on the list.

### States that are not faults

Four things the panel shows that look like something went wrong:

- A "Loading…" spinner while the panel reads the current round.
- "No round yet", with "The author hasn't opened a review round on this
  PR." — no **Round** has ever been opened here. This is what a pull
  request looks like before its first "Ready for review".
- "No reviewers", with "This round has no tracked reviewers." — the
  **Round** exists but its snapshot came out empty.
- "This round changed since you loaded it." with a "Refresh" button —
  somebody else changed the round while your tab was open. PRSync never
  re-renders the panel under your cursor; you click "Refresh" when you
  are ready.

The one that is a fault is "Couldn't load the current round. Refresh the
page to try again." Reload the page; if it persists, ask whoever set
PRSync up.

## What arrives in Teams

Two messages, both personal 1:1 DMs from PRSync, both link-out only. The
only thing to click is the button that opens the pull request; there is
nothing to fill in and nothing to reply to.

When a **Round** opens, one message goes to each person on the
**Reviewer list**:

> **Round 2 — Implementation Review open for review**
>
> PR — Wire the panel to the rounds API
>
> Author — Sam Okafor
>
> `[ Open PR ]`

When a **Round** closes, one message goes to the **Author**, and to
nobody else:

> **Round 2 — Implementation Review complete — safe to proceed**
>
> PR — Wire the panel to the rounds API
>
> `[ Open PR ]`

That second message is the one PRSync exists to deliver. It means the
**Quorum** was reached and the round is finished, so the implementation
can be regenerated from the refined use case without a review landing
mid-flight.

Nothing else is ever sent. Ticking **Done** sends no message, and
**Cancel round** sends no message at all — a **Round** that ends
**Cancelled** is silent by design. The round name in a message is the one
that was in force when it was sent, so an author who renames a round
afterwards will see the old name in the message already delivered.

### If the same message arrives twice

That is deliberate, and there is nothing to report. PRSync delivers
at-least-once: if a delivery attempt is interrupted somewhere it cannot
verify, it retries rather than assuming the message got through. A
duplicate "safe to proceed" is an accepted outcome; a missing one is the
failure the whole product exists to prevent, and PRSync is built to
prefer the first.

## I didn't get a message

Four things to check, in this order. The first three you can answer
yourself.

**1. Have you added the PRSync app to Teams?** This is by far the most
common answer, and the one that gives you no clue on its own. Without it
you are **Unreachable**: PRSync has nowhere to send anything, records
that fact and moves on, and nothing tells you. Go through "Install
PRSync" above, then message the PRSync chat and check that it replies.

**2. Was a round actually opened?** Open the pull request and look at
the PRSync tab. "No round yet" means nothing has been opened, and no
message was due. A **Round** opens only when the author clicks "Ready for
review" — pushing commits, adding reviewers or moving a pull request out
of draft opens nothing.

**3. Were you on the snapshotted reviewer list?** The **Reviewer list**
is taken at the moment of that click, so if you were added as a reviewer
after the **Round** opened, you are not on it for this round and no
message was sent to you. You will be on the next round's list if you are
a reviewer when it opens. Two other
ways to be absent from it: being a reviewer through a team or group
rather than as yourself, and being the **Author**, who is never on their
own round's list. The panel shows the snapshot, so you can check this
yourself — if your name is not in the reviewer rows, that is your answer.

**4. Ask whoever set PRSync up.** The ladder ends here, and it ends here
for a reason rather than because there is one more page to read. Every
delivery attempt is recorded in the **Notification log** — sent, no
identity, or failed — and that log lives in the deployment's storage. No
screen in PRSync shows it: not the panel, not Teams, not to you and not
to the author. Only the **Operator** who runs the deployment can read it,
and they can tell you which of the three your message got. If it says no
identity, the answer was step 1.

## Where the words come from

[`ubiquitous-language.md`](ubiquitous-language.md) is the single source of
truth for PRSync's terminology, and it holds the full definition of every
word this guide has bolded, plus the ones this guide never needed.

The five glosses above name their canonical term verbatim on purpose. A
friendlier paraphrase — "the round closes when the team has finished
reviewing" — is not a softer way of saying the same thing; it describes a
product that behaves differently from this one. If this guide and the
terminology file ever disagree, the terminology file is right and this
guide has a bug worth reporting.

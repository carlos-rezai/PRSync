# PRSync — Setup guide

The ordered path from an empty Azure subscription to a working PRSync, in
eleven stages, after a stage 0 that is preparation rather than a step.
Written for the **Operator** — the one person standing PRSync up for an
organisation.

This guide owns **sequence** and nothing else. It tells you what to do
next, which orderings you cannot swap, and how you know a stage worked.
It deliberately names **no setting value and no fix for a broken stage**:
those live in [`deployment.md`](deployment.md), which owns every value,
the rationale behind it, and the failure symptoms. So each stage below
ends the same way: how you know it worked, and where to read what it
looks like when it did not.

Read the stages in order. Three of the orderings are load-bearing rather
than merely tidy, and each is called out where it applies:

- **Stage 3 before stage 4** — you cannot set a messaging endpoint to a
  URL that does not exist yet.
- **Stage 6 before stage 7** — stage 7's check needs a **Reachable**
  recipient, and you are the only one you can make reachable.
- **Stage 8 on its own**, not folded into stage 7 — a folded step is a
  skipped step, and this is the one whose failure looks like working.

Some stages need an authority you may not hold — an Azure subscription,
Teams tenant administration, ownership of the Azure DevOps organisation.
Those are flagged inline where they arise rather than split into separate
tracks: the whole value of this document is being _one_ sequence. If a
flagged stage is not yours, that is the moment to go and ask, not four
stages later.

There are two Function Apps and they are not interchangeable — the
**bot** goes up at stage 3 and the **API** at stage 7. Where a stage says
which, it means it.

### The stages

0. [Before you start](#stage-0--before-you-start)
1. [Storage: three tables and one queue](#stage-1--storage-three-tables-and-one-queue)
2. [Register the Azure Bot and its secret](#stage-2--register-the-azure-bot-and-its-secret)
3. [Deploy the bot Function App](#stage-3--deploy-the-bot-function-app)
4. [Messaging endpoint and the Teams channel](#stage-4--messaging-endpoint-and-the-teams-channel)
5. [Allow custom app upload in the tenant](#stage-5--allow-custom-app-upload-in-the-tenant)
6. [Package and sideload the Teams app, yourself first](#stage-6--package-and-sideload-the-teams-app-yourself-first)
7. [Deploy the API Function App](#stage-7--deploy-the-api-function-app)
8. [Allow the Azure DevOps origins in the API's CORS](#stage-8--allow-the-azure-devops-origins-in-the-apis-cors)
9. [Build, package, publish and install the extension](#stage-9--build-package-publish-and-install-the-extension)
10. [End to end on a real pull request](#stage-10--end-to-end-on-a-real-pull-request)
11. [Roll out](#stage-11--roll-out)

Then [where to go next](#where-to-go-next), which is mostly the two
documents this one deliberately does not repeat.

---

## Stage 0 — Before you start

**Authority:** an Azure subscription you can create resources in, and
permission to create an app registration in your tenant. Stages 5, 6 and
9 need more, and say so.

Have these before you begin, so that nothing stops you halfway:

- The Azure CLI and the Azure Functions Core Tools, both signed in.
- Node.js and this repository cloned, with dependencies installed.
- `tfx-cli`, and a Visual Studio Marketplace publisher, for stage 9.
- Somewhere to keep one secret you will only be shown once (stage 2).

Then decide and write down the four names you will use throughout: the
resource group, the storage account, the **bot** Function App and the
**API** Function App. Everything in this guide refers back to those four,
and inventing them one stage at a time is how people end up pointing the
API at the wrong storage account.

This guide covers a real deployment only. To run PRSync on your own
machine instead — which needs a storage emulator and a public tunnel, and
is a contributor's concern rather than an operator's — read
[Local development](deployment.md#local-development) and stop here.

**Done when** the four names are written down somewhere you will still
have them at stage 9, and every tool above answers when you run it.

**If it isn't:** nothing has been created yet, so there is nothing to
diagnose — go back through the list.

---

## Stage 1 — Storage: three tables and one queue

Nothing in PRSync creates storage on the way past. Every client is built
against a name that has to be there already, so this is the first stage
for a reason: a missing table fails at the first request, and a missing
queue does not fail at all — rounds open and close correctly and no DM is
ever sent.

Create the storage account, then the three tables and the one queue named
in [the tables and the queue](deployment.md#prerequisite-the-tables-and-the-queue-must-already-exist),
which also explains why they may live in one storage account or two.

**Done when** listing the storage account's tables shows all three, and
its queues show the one.

**If it isn't:** the same section records what each missing name costs —
[the tables and the queue](deployment.md#prerequisite-the-tables-and-the-queue-must-already-exist).

---

## Stage 2 — Register the Azure Bot and its secret

**Authority:** creating an app registration is restricted in some
tenants. If it is in yours, this is the stage to hand to whoever holds
that permission.

A personal 1:1 DM needs a real bot, so the Azure Bot resource has to
exist before its Function App is of any use: the resource owns the app
registration the bot authenticates with, and it is what connects Teams at
stage 4. Create it, choose the free tier and the single-tenant app type,
create a client secret, and record the three values it gives you.

Follow steps 1 to 3 of
[Registering the Azure Bot resource](deployment.md#registering-the-azure-bot-resource),
and stop there — its later steps are stages 4 and 5 of this guide.

Copy the secret the moment it is created. It is shown once, and a
regenerated secret means revisiting stage 3.

**Done when** you hold three values — an application id, a secret and a
tenant id — and none of them is still on a screen you have closed.

**If it isn't:** [bot configuration](deployment.md#prerequisite-bot-configuration)
names what each of those three becomes, and what a blank one does.

---

## Stage 3 — Deploy the bot Function App

Deploy `packages/bot` to the **bot** Function App, then apply its
settings: the storage connection, the queue connection, and the four Bot
Framework settings from stage 2. All of them, and their exact names, are
in [bot configuration](deployment.md#prerequisite-bot-configuration); the
publish command is in [Deploying the bot](deployment.md#deploying-the-bot).

The bot refuses to start without any of the four, which is deliberate: a
bot that starts with a missing password accepts no activity, and the only
symptom is DMs that never arrive.

**Done when** the Function App is running and lists exactly two
functions — the messaging endpoint and the queue worker. Both are named
in [Deploying the bot](deployment.md#deploying-the-bot).

**If it isn't:** one function instead of two, or none, is the entry-point
failure described at the end of
[Deploying the bot](deployment.md#deploying-the-bot).

---

## Stage 4 — Messaging endpoint and the Teams channel

**Depends on stage 3.** This stage does nothing but write down where the
bot lives, and there is no URL to write down until the Function App
exists. Attempting it first is the most common way to end up with a bot
resource that looks configured and receives nothing.

Two settings on the Azure Bot resource from stage 2: point its messaging
endpoint at the bot Function App's `/api/messages` route, and enable the
Microsoft Teams channel. Both are steps 5 and 6 of
[Registering the Azure Bot resource](deployment.md#registering-the-azure-bot-resource).

That route is not yours to choose — it is the route the function declares
in code. Point the bot anywhere else and every inbound activity 404s,
which Teams shows a person as nothing at all. Why that endpoint is
reachable without a function key, and why that does not make it an open
endpoint, is recorded in
[Why `/api/messages` is anonymous](deployment.md#why-apimessages-is-anonymous-and-why-that-is-not-an-open-endpoint) —
read it once, so the pairing is not re-raised as a finding later.

**Done when** the endpoint is saved on the bot resource and Microsoft
Teams appears in its list of connected channels.

**If it isn't:** the last row of the symptom table in
[Verifying a deploy](deployment.md#verifying-a-deploy) covers an install
that captures nothing.

---

## Stage 5 — Allow custom app upload in the tenant

**Authority:** Teams tenant administration. If that is not you, this is
the stage that will block the rest, so raise it now — stage 6 cannot
start until it is done.

PRSync is sideloaded inside one organisation's tenant and is never listed
in the Teams Store, so uploading a custom app has to be permitted by
policy for the people who will use it. The setting is step 7 of
[Registering the Azure Bot resource](deployment.md#registering-the-azure-bot-resource).

**Done when** the Teams setup policy covering your users shows custom app
upload turned on.

**If it isn't:** nobody can install PRSync at all, including you at
stage 6 — [Packaging and sideloading the Teams app](deployment.md#packaging-and-sideloading-the-teams-app)
states the dependency.

---

## Stage 6 — Package and sideload the Teams app, yourself first

Build the Teams app package, then install it in personal scope for
yourself before anyone else touches it. The package script, the manifest
edits that must happen before the first build, and the install steps are
all in
[Packaging and sideloading the Teams app](deployment.md#packaging-and-sideloading-the-teams-app).

Do not skip the manifest edit it describes. The bot id ships as a
placeholder that is a perfectly valid identifier, so the package uploads
without complaint and then resolves to no bot: the app installs and never
speaks.

Installing is the only thing that makes a person **Reachable**. Nothing
else creates their identity row, and a person who never installed the app
is not an error — they are a logged fact, and their rounds proceed
normally without them being told anything.

**Done when** you send the PRSync chat any message and it replies. That
reply is the proof your own identity was captured, and it makes you the
recipient stage 7 needs.

**If it isn't:** an install that captures nothing is the last row of the
symptom table in [Verifying a deploy](deployment.md#verifying-a-deploy) —
usually the endpoint or channel from stage 4.

---

## Stage 7 — Deploy the API Function App

**Depends on stage 6.** Not to deploy — to _check_. This stage's check
sends a real DM, which needs a reachable recipient to send it to, and
stage 6 is what made one exist. Sideload afterwards instead and your
first end-to-end attempt fails in the one place that looks exactly like a
code defect.

Deploy `packages/api` to the **API** Function App and apply its settings:
the storage connection, the queue connection, and optionally the queue
name and the quorum. They are in
[API configuration](deployment.md#prerequisite-api-configuration), and the
publish command is in [Deploying the API](deployment.md#deploying-the-api).

If you overrode the queue name on one Function App, override it on the
other. The queue is the entire boundary between the two apps and its name
is the only place they meet; a disagreement is a queue filling on one
side while the worker listens to an empty one on the other, with nothing
red anywhere.

This stage's check is the most diagnostic moment in the whole sequence,
and it is worth not hurrying: it proves storage, the bot, the endpoint,
your install, the queue and both sets of settings, with no Azure DevOps,
no panel and no round involved. Every stage after this one adds a surface
that can fail on its own, so getting a DM here is what lets you stop
suspecting the ones behind you.

**Done when** a queue message you enqueue by hand lands as a real DM in
your own Teams chat. Use the recipe in
[Exercising the worker without the panel](deployment.md#exercising-the-worker-without-the-panel),
with your own email address as the recipient.

**If it isn't:** the symptom table in
[Verifying a deploy](deployment.md#verifying-a-deploy) is ordered to
narrow this fastest — start with where the message stopped.

---

## Stage 8 — Allow the Azure DevOps origins in the API's CORS

**This is its own stage on purpose.** It is one setting on the app you
just deployed, and folding it into stage 7 is how it gets skipped — which
matters more here than anywhere else, because this is the failure that
yields a working-looking install with a dead panel. The extension
installs, the tab appears, the panel renders, and then nothing works,
with nothing in the Function App's own logs to explain it, because the
API was never reached.

Add the origins the panel is served to and from to the API Function App's
allowed origins. Which two, how to confirm the exact values for your own
install rather than trusting a list, and why a wildcard is the wrong
answer, are all in
[Function App CORS](deployment.md#prerequisite-function-app-cors-must-allow-the-ado-org-origin).

**Done when** the API Function App's CORS configuration lists both
origins, and neither is a wildcard.

**If it isn't:** you will not find out until stage 9, and the symptom
will be a panel that cannot load with nothing in the logs to say why —
[Function App CORS](deployment.md#prerequisite-function-app-cors-must-allow-the-ado-org-origin)
explains the silence.

---

## Stage 9 — Build, package, publish and install the extension

**Authority:** a Marketplace publisher, and permission to install an
extension into the Azure DevOps organisation. The second is usually the
organisation's owner. If that is not you, you can still complete the
build and publish, and hand over only the install.

**This stage comes after stage 7**, and not for tidiness: the panel is a
static bundle whose API base URL is baked in when it is built, not read
when it runs. There is no post-hoc override — changing it later means
building and publishing the extension again — so the API has to exist
before the build that will point at it.

Set the panel's base URL, build, package, publish and share the
extension, then install it into the organisation. The setting is in
[panel configuration](deployment.md#prerequisite-panel-configuration), and
every step from build to upload is in
[Packaging and publishing the extension](deployment.md#packaging-and-publishing-the-extension) —
including the two manifest values that must change before the first
package.

**Done when** you open any pull request in the organisation, select the
PRSync tab, and the panel renders a round or an empty state — rather than
a spinner that never resolves or a "couldn't load" error.

**If it isn't:** a panel stuck on "couldn't load" with nothing in the
Function App's logs is stage 8, every time. The other panel checks worth
running — theming and height — are steps 1 to 4 of
[Verifying a deploy](deployment.md#verifying-a-deploy).

---

## Stage 10 — End to end on a real pull request

Everything is deployed; this stage proves the parts work together, in the
order a **Teammate** will actually meet them.

You need three things: a real pull request you are the author of, and two
colleagues who have both installed the Teams app, added to it as
reviewers. Two of them, because the default **Quorum** is two — and they
have to be other people, because you are never a reviewer of your own
pull request. Walk them through stage 6's install steps if they have not
done it.

Then open a round from the panel with "Ready for review". Each reviewer on
the round gets a DM naming the pull request and the round label. Have both
of them tick **Done**, and the round closes.

Two things about that close are worth knowing before they surprise you. A
round closes on **Quorum** — a configured count, two by default — so it
can finish while people on its **Reviewer list** have not looked at the
pull request at all. And only closing notifies: a round the author
cancels instead is equally final and messages nobody.

Steps 5 to 8 of [Verifying a deploy](deployment.md#verifying-a-deploy)
are this check in full, including what the delivery log should hold
afterwards.

**Done when** the reviewers on the round received their DMs, and the
author received exactly one "safe to proceed" DM when the round closed.

**If it isn't:** the symptom table at the end of
[Verifying a deploy](deployment.md#verifying-a-deploy) again — a DM that
never arrives has a small number of causes and they are listed in the
order that narrows fastest.

---

## Stage 11 — Roll out

One thing left, and it is the one you cannot do for anybody.

Each **Teammate** installs the Teams app themselves. There is no
bulk-install setting, no admin action that adds the bot to a person's
Teams, and nothing to go looking for — installing is what captures the
conversation reference PRSync sends DMs through, and it happens in that
person's own Teams. Someone who has not installed it experiences nothing
at all: rounds open and close around them, no DM arrives, and they cannot
tell that apart from "no round has opened yet". Nothing warns them, and
nothing warns you.

So hand each person exactly two things:

- `prsync-teams.zip` — the file stage 6 produced. One file serves the
  whole team; it carries nothing specific to anyone. An administrator can
  instead publish it to the organisation's app catalogue, which still
  does not install it on anyone's behalf.
- [The user guide](user-guide.md) — their own two install steps are its
  first section, and the reason a missing DM is nearly always the first
  of them is its last.

Nothing on the Azure DevOps side needs a per-person step: the extension
was installed once for the organisation at stage 9, so the panel is
already on every pull request.

**Done when** a **Teammate** other than you has opened a round on their
own pull request and its reviewers received their DMs — which is the
first moment PRSync is working for the team rather than for its operator.

**If it isn't:** send them to "I didn't get a message" in
[the user guide](user-guide.md). The first three rungs of that ladder are
theirs to check; the fourth is yours, because the delivery log is in your
deployment's storage and no screen in PRSync shows it.

---

## Where to go next

- [`deployment.md`](deployment.md) — every setting value, the reasoning
  behind it, and the failure symptoms. Read by lookup, not straight
  through.
- [`user-guide.md`](user-guide.md) — what PRSync does, for the people it
  was deployed for. Authoritative on behaviour; this guide is
  authoritative on order.
- [`ubiquitous-language.md`](ubiquitous-language.md) — the definitions of
  the terms both guides use precisely.

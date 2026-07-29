# 03 — Teams Notifications Refactor

Refactor plan for Feature 3 (`teams-notifications`, issues #18–#24),
written 2026-07-29 against the feature-complete state: `packages/bot` at
103 tests across 18 files, green under `lint`, `typecheck` and `test`.

Scope is `packages/bot` only. No behaviour changes, no API contract
changes, no card changes, and nothing in `packages/api` or
`packages/extension` is touched.

## Problem Statement

Feature 3 shipped as five sequential slices, each its own issue, and the
build order fossilised in exactly the way the extension panel's did
before issue #14 cleaned it up. Three things are wrong with the result.

**The `teams/` layer has one module that is really four.** `BotHost`
holds the bot's activity routing, the settings the adapter authenticates
with, the adapter factory itself, and a hand-written translation between
the Azure Functions HTTP types and the Bot Framework request/response
types. Every other module in the package — in all three packages — is one
module in a folder named after it with one co-located test. `BotHost` is
the single exception, and the name is the tell: it is not a term from the
ubiquitous language and does not describe any one thing. It is the name
you give a file that accumulated.

The clearest evidence that it is already four modules is that it has
**two** test files, one per concern that happened to get tested. The
source never split; the tests did, and then stopped.

**Half of it is untested.** The two test files cover the settings reader
and the activity routing. Nothing at all covers the adapter factory or
the translation layer — and the translation layer is not trivial: it
copies request headers one by one into a plain object, collects a status,
headers and body written by the adapter, and attaches a JSON body only
when the adapter actually sent one. Every one of those is a behaviour
that can regress silently. The whole `/api/messages` path is anonymous by
necessity, which makes this the single most sensitive module in the
package and the one with the least coverage.

**The only module in the package with no test at all is `TeamsSender`.**
It is not untested because it is trivial — it carries the deliberate
conversation-reference cast the design forbids reading into, and it wraps
a card as a message attachment. It is untested because it takes a
concrete `CloudAdapter`, so there is no way to drive it without standing
up Bot Framework. The seam that makes every other module testable is
itself the one thing that cannot be tested.

Two smaller things sit underneath. The Table Storage status-code reader
is duplicated **verbatim** — implementation and comment both — across the
two repositories, in a package whose `lib/` layer exists precisely to
hold pure helpers like it. And the three tests that assert
`.claude/CLAUDE.md` has not drifted from the source fail outright on a
fresh clone, because that file is deliberately untracked; there is no CI
yet, so the trap is armed and has never been sprung.

## Solution

Split `BotHost` into the four modules it already is, give the two
untested halves the tests they never got, make `TeamsSender` testable by
narrowing what it asks for, and clear the two smaller items.

The split is a pure move. Every consumer of `teams/` — the composition
root and the two entry points — imports through the layer's barrel
already, so no consumer changes at all. The two existing test files move
alongside the code they test and change one import line each; they must
pass otherwise **unedited** after every commit, which is the safety
argument for the whole group. That is the same argument the extension
refactor used for its `hooks/` extraction, and it held there.

`TeamsSender` and the translation layer both become testable the same
way, and it is a way the codebase already uses: narrow the parameter from
the vendor class to a structural interface naming only the one operation
actually called. `QueueNotificationPort` in the API does exactly this with
its queue — the Azure SDK's client satisfies the interface without
knowing it exists. `CloudAdapter` satisfies these the same way, so the
composition root is unchanged and the layer rule that only `teams/`
imports the vendor SDK is unaffected.

The duplicated status-code reader becomes one tested module in `lib/`,
which is what `lib/` is for. The documentation-drift tests are gated on
the file being present, which is an honest statement of what they guard:
the author's working copy, where that file lives.

## Commits

Each commit leaves the package green under `lint`, `typecheck` and
`test`. The baseline is 103 tests across 18 files.

### Group A — split the module into the four it already is

Pure moves. No production behaviour changes in this group, no test
assertions change, and the test count stays at 103 throughout. The two
existing test files change exactly one line each: the path they import
their subject from.

**1. Extract the bot's settings into their own module.**
Move the settings-name constants, the config interface and the reader
that refuses to start without them into a new `BotConfig` module in
`teams/`. Move its existing test file alongside it under the module's own
name, changing only its import path. The module that keeps the adapter
factory now imports the config type from its new sibling by direct file
path, per the within-layer import rule. Add the new module to the layer
barrel. The composition root already imports the reader through that
barrel, so it is untouched.

**2. Extract the bot's activity routing into its own module.**
Move the activity handler factory, the help reply text, the
member-includes-the-bot predicate and the identity reader into a new
`TeamsBot` module in `teams/`. Move its existing test file alongside it
under the module's own name, again changing only the import path. Add it
to the barrel. This is the largest move by line count and the one with
the most existing coverage behind it — five tests driving a real
`ActivityHandler` through Bot Framework's own test host — so it is the
safest to move and the best early confirmation the split is clean.

**3. Extract the HTTP-to-Bot-Framework translation into its own module.**
Move the messaging-endpoint interface, the request adapter, the collected
response class and the endpoint factory into a new `MessagingEndpoint`
module in `teams/`. Add it to the barrel. It arrives with no test, which
is exactly what it has today — no coverage is lost and none is gained
yet; commit 6 is where that changes. The entry point that consumes the
interface imports it through the barrel and is untouched.

**4. Rename what remains to say what it is.**
What is left in the original file is the adapter factory alone. Rename
the folder and file to `BotAdapter`, update the barrel, and the name
`BotHost` leaves the codebase. After this commit the `teams/` layer is
five modules — bot, config, adapter, messaging endpoint, sender — each in
a folder named after it, which is the convention every other layer in
every other package already follows.

### Group B — close the two coverage gaps the split exposed

**5. Narrow what the messaging endpoint asks for.**
Change the endpoint factory's two parameters from the vendor adapter
class and the vendor activity-handler class to structural interfaces
declaring only the single method each one is actually called through.
Both vendor types satisfy the new interfaces structurally, so the
composition root does not change and neither does anything else. This
commit adds no tests; it is the enabling move for the next one, kept
separate so that if it breaks anything the breakage is unambiguous.

**6. Test the translation layer.**
Add the module's co-located test. Everything it asserts is behaviour that
exists today and is currently unguarded: that every inbound request
header reaches the adapter, that the parsed body and the method reach it,
that the bot is run for the turn, that the status the adapter chose is
returned unaltered rather than replaced with a default, that headers the
adapter set survive, that a body it sent comes back as a JSON body, and
that when it sends no body the response carries no body key at all. These
pass on arrival — this is characterisation of existing behaviour, not
new behaviour, so there is no RED step to stop at.

**7. Test the adapter factory.**
Add its co-located test. This one is deliberately thin and the file says
so in its header: the adapter's JWT validation is Bot Framework's, and a
test of it would only re-implement a vendor — the same reasoning the
settings test already records for itself. What is asserted is what PRSync
owns: that a valid config yields an adapter exposing the two operations
the rest of the package depends on, the inbound processing call and the
proactive continuation call. It catches a constructor that throws and a
shape the rest of the package assumes without checking.

**8. Narrow what the sender asks for.**
Change the sender factory's first parameter from the vendor adapter class
to a structural interface naming only the proactive-continuation call.
The vendor class satisfies it, so the composition root is unchanged. As
with commit 5, no tests are added here.

**9. Test the sender.**
Add the module's co-located test — the last module in the package to get
one. It asserts what the seam promises: that the stored conversation
reference is handed to the adapter unmodified and unreconstructed, that
the bot's app id accompanies it, and that what lands in the conversation
is the card as an attachment rather than the card as text. Driven through
a recording fake of the narrowed interface, so there is no Bot Framework
in the file.

### Group C — the two smaller items

**10. Give the status-code reader a home and a test.**
Add a `statusCodeOf` module to `lib/` holding the single pure function
that reads a numeric status off an SDK error shape, with the co-located
test every `lib/` function is required to have — covering an error
carrying a numeric status, one carrying a non-numeric status, one with no
status at all, and the non-object cases. Add it to the `lib/` barrel.
Nothing consumes it yet, so the package is green on arrival.

**11. Point the identity repository at it.**
Delete that repository's private copy and import the shared one
cross-layer through the `lib/` barrel. Its five existing tests pass
unedited.

**12. Point the notification-log repository at it.**
The same change in the second repository, which removes the last copy.
Separate from commit 11 so each repository's suite proves the swap on its
own. After this commit the helper exists once in the package.

**13. Extract the shared source walker used by the policy tests.**
The layer-policy test and the deployment-docs test each hand-roll a
directory walk over the package's source. Move one walker into the
package's shared test fixtures, where every other cross-layer test helper
already lives, and point the layer-policy test at it. Its three tests
pass unedited.

**14. Point the deployment-docs test at the shared walker.**
The same change for the second consumer. Kept separate for the same
reason as 11 and 12 — this file's eight tests read both source and
documentation, so a regression here is worth isolating.

**15. Gate the documentation-drift tests on the file being present.**
Guard the describe that asserts against the untracked project-instructions
file so it skips when that file is absent instead of failing. Record in
the file's header why: the file is a deliberate local override, the tests
guard the author's working copy against drift, and a clone was never
given the file to drift from. The tests still run — and still fail on
real drift — in every working copy that has it.

### Group D — record what changed

**16. Update the project instructions' `teams/` layer row.**
The layer table describes `teams/` as adapter wiring plus the sender; it
is now five named modules. Update it, and note that the split is a
deviation from the design log's layer table, which is immutable.

Applied on disk, not committed — the project-instructions file is
gitignored, which is the same trap the dev journal records hitting on
plan 01's commit 20 and plan 02's commit 40. Future sessions read the
on-disk file, so the convention IS documented; force-adding it overrides
a deliberate gitignore choice and remains the author's call. This commit
therefore changes nothing in version control by design.

**17. Add the dev journal entry.**
What moved, why `BotHost` was four modules, the two coverage gaps the
split exposed, and the structural-port trick as the thing to reach for
next time a vendor class blocks a test.

## Decision Document

**The split is four modules, not two or three.** The two-way split along
the seam the existing test files imply would leave one module holding
settings, adapter construction and HTTP translation — three concerns that
share nothing but a file. The three-way variant, folding the adapter
factory in with the translation layer, is defensible on the grounds that
the factory is a handful of lines; it was rejected because the factory is
the one thing the composition root builds once and shares in both
directions, and a module that is hard to describe in a sentence is the
thing this refactor exists to stop producing.

**The settings module stays in the `teams/` layer.** It imports no vendor
SDK and is pure, which technically qualifies it for `lib/`. It stays
because it is the bot's authentication, inseparable from the adapter it
configures, and `teams/` is where a reader looks for it. `lib/` holding
deployment settings would be a worse boundary than the one being fixed.

**Two parameters narrow from vendor classes to structural interfaces.**
The sender takes a proactive-continuation port; the messaging endpoint
takes a request-processing port and an activity-runner port. Each names
exactly one method. This is not a new pattern — it is what the API's
queue producer does with the Azure queue client, and the reason that port
is testable with no storage account. The vendor classes satisfy all three
structurally, so the composition root is unchanged, and the rule that
only `teams/` imports the vendor SDK is unaffected: the rule constrains
where the SDK may be imported, not that every module in the layer must
import it.

**The alternative was a cast.** The package's fixtures already cast for
vendor types with no honest fake — the invocation context and the HTTP
request are both built that way, with a comment explaining that the real
types carry fields no fake can populate truthfully. A cast would have
worked here too. The port is preferred because it makes the dependency
one named method instead of a whole class, and because two of the three
ports are on production signatures rather than in a test fixture.

**The adapter factory's test is deliberately shallow.** Asserting more
would mean asserting Bot Framework's own token validation, which the
settings test already records as out of bounds for exactly this reason.
The test's header will say so, so that its thinness reads as a decision
rather than as an oversight.

**The status-code reader goes to `lib/`, not to a shared module inside
`storage/`.** It is pure, side-effect-free and reads its argument
structurally without importing the SDK — the definition of what `lib/`
holds. Putting it in `storage/` would publish it on that layer's barrel,
which is the layer's public API, for no consumer outside the layer.

**It stays duplicated across packages.** The API's round repository has a
third copy. The two packages share no code and no synchronous call by
design — that is the whole topology decision behind the queue boundary —
so extracting a shared module would reintroduce the workspace-dependency
deploy problem the design log ruled out. The copy is an accepted cost,
already recorded as one.

**The documentation-drift tests skip rather than being deleted, moved or
made to pass.** Deleting them gives up a real check. Moving their claims
into a tracked document changes where the project's conventions live,
which is a bigger decision than this refactor. Making them pass
everywhere means force-adding a gitignored file, which the dev journal
twice declined to do without the author. Skipping when absent is the only
option that keeps the check where it works and stays quiet where it
cannot.

## Testing Decisions

**What a good test looks like here** — the standard this package already
holds, and the one the new tests must meet. A test drives the module's
public entry point and asserts what an outside observer can see: a DM
that arrived and what it said, a row that records an outcome, a status
that came back. It never asserts which branch ran, never reaches into a
private, and never restates a shape that another test already pins.

The clearest example already in the package is the dispatcher's test: it
runs a real identity directory over an in-memory repository, and asserts
cards as the card builders' output rather than as hand-written JSON,
because the builders are already pinned to the frozen handoff design by
their own tests. Restating the JSON there would duplicate a contract
rather than check one.

**Modules gaining tests:** the HTTP translation layer, the adapter
factory, the sender, and the status-code reader. That is every module in
the package that does not have one today.

**Modules whose tests move but do not change:** the settings reader and
the activity routing. Their assertions must survive the split
byte-for-byte, one import line aside. This is the safety net for the
whole of group A — if an assertion has to be edited to keep passing, the
move was not a move.

**Prior art each new test follows.** The translation-layer test follows
the entry-point tests, which drive a handler with a faked collaborator
and assert what it returned. The sender's test follows the recording-fake
pattern in the shared fixtures, where what was sent is exposed as a
property to assert on rather than read back off a spy. The status-code
reader's test follows the other `lib/` tests: a pure function, its cases
enumerated. The adapter factory's test follows the settings test's
explicit stance on where the vendor's responsibility begins.

**New fakes go in the package's shared fixtures**, not in the test files,
matching the rule the fixtures file already states: every type imported
as a type, nothing `async` merely to look like what it fakes, and
anything asserted on exposed as a property.

**Expected end state:** roughly 118 tests across 22 files, up from 103
across 18. The count matters only as a check that group A added none and
groups B and C added them where intended.

## Out of Scope

- **`packages/api` and `packages/extension`.** Untouched. The queue is the
  entire boundary between the two Function Apps, so nothing in this plan
  can reach the API.
- **The duplicated queue envelope type.** Declared in both packages by
  design, recorded in the accepted costs, and asserted by a test that
  checks it is still declared twice. Not a defect.
- **The no-op notification port sitting unwired in the API.** Deliberate,
  and protected by a test that says why.
- **The dispatcher's test file.** At roughly 480 lines it is the largest
  test in the package, which invites the same treatment the extension's
  container test got. It does not need it: one behaviour-named describe,
  fifteen tests, no build-slice fossilisation. It is long because it is
  well commented.
- **The shared types module.** Larger than its counterparts in the other
  packages, but one cohesive module. Splitting types across a leaf layer
  buys nothing the barrel does not immediately flatten.
- **The API's four-handler duplication.** Flagged in the dev journal as
  the API-side twin of what extension issue #14 fixed on the client. It
  belongs to `round-lifecycle` and wants its own issue.
- **Adding CI.** The documentation-drift trap is what would have exposed
  it, and this plan defuses that trap rather than building the thing that
  would trip it. Worth its own issue.
- **Anything the design log defers:** interactive card actions, surfacing
  unreachable reviewers in the panel, the identity-override UI, reminder
  notifications, any channel or group-chat surface.

## Further Notes

**Design logs are immutable.** The Feature 3 log's layer table describes
`teams/` as adapter wiring plus the sender. After this refactor that is
five named modules. The deviation is recorded in the project instructions
and in this plan, never by editing the log — the same treatment the
extension's `hooks/` layer received.

**The gitignore trap will recur at commit 16**, for the third time. It is
called out in the commit itself so it is not rediscovered mid-execution.

**Why now rather than during the build.** Every one of these is a
consequence of shipping five vertical slices in sequence, which was the
right way to build the feature. The extension panel produced the same
shape and needed the same pass. This is the cost of that approach, paid
on schedule rather than deferred.

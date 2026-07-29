import { describe, it, expect } from "vitest";
import {
  createNotificationDispatcher,
  type NotificationDispatcher,
} from "./NotificationDispatcher";
import { createIdentityDirectory } from "../IdentityDirectory/IdentityDirectory";
import { authorCard, reviewerCard } from "../../cards";
import {
  dedupeKey,
  type CapturedIdentity,
  type DeliveryStatus,
  type NotificationLogEntry,
  type NotificationMessage,
} from "../../lib";
import {
  makeFailingTeamsSender,
  makeIdentityRepository,
  makeNotificationLog,
  makeTeamsSender,
  type InMemoryNotificationLog,
  type RecordingTeamsSender,
} from "../../test/fixtures/fakes";
import {
  CARD_CONTENT,
  OTHER_CONVERSATION_ID,
  OTHER_PERSON,
  OTHER_RECIPIENT_ADO_ID,
  PERSON,
  STRANGER_EMAIL,
  UNRESOLVABLE_EMAILS,
  makeCapturedIdentity,
  makeConversationRef,
  makeNotificationLogEntry,
  makeNotificationMessage,
} from "../../test/fixtures/fixtures";

// The deepest module in the feature: one message in, one DM out. Issue
// #20 gave it the happy path — resolve the recipient, pick the card their
// event calls for, send it to their own chat. This slice gives it the
// guarantees behind that: dedupe, outcome recording, and the split
// between a failure worth retrying and one that is simply the answer.
//
// Driven end-to-end against a REAL `IdentityDirectory` over the in-memory
// repository, a recording `TeamsSender` and an in-memory notification
// log, mirroring how `packages/api`'s `RoundService.test.ts` runs against
// a real repository fake. Every assertion is about what a person and the
// log can observe — a DM that arrived or did not, a row that says what
// happened — never about which branch ran. And because the sender is the
// only seam Bot Framework lives behind, there is no `botbuilder` in this
// file at all.
//
// Delivery is ordered check → send → mark, at-least-once by deliberate
// choice: the narrow window where a send succeeds and the mark fails
// yields a duplicate DM rather than a lost one. A missing "safe to
// proceed" is the exact failure this product exists to prevent.

/** ISO 8601, to the millisecond, in UTC — the project's date rule. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Harness {
  dispatcher: NotificationDispatcher;
  sender: RecordingTeamsSender;
  log: InMemoryNotificationLog;
}

interface HarnessOptions {
  /** The people who have sideloaded PRSync. Everyone else is unreachable. */
  installed?: CapturedIdentity[];
  /** Defaults to a sender Teams is accepting. */
  sender?: RecordingTeamsSender;
  /** Defaults to a log with no prior attempt in it. */
  log?: InMemoryNotificationLog;
}

async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const directory = createIdentityDirectory(makeIdentityRepository());
  for (const identity of options.installed ?? []) await directory.capture(identity);

  const sender = options.sender ?? makeTeamsSender();
  const log = options.log ?? makeNotificationLog();
  return {
    dispatcher: createNotificationDispatcher(directory, sender, log),
    sender,
    log,
  };
}

/** A dispatcher whose directory holds exactly the people named. */
async function withInstalled(
  ...identities: CapturedIdentity[]
): Promise<Harness> {
  return makeHarness({ installed: identities });
}

/** The second installed teammate, reachable in a chat of their own. */
function otherPersonIdentity(): CapturedIdentity {
  return makeCapturedIdentity({
    email: OTHER_PERSON.email,
    aadObjectId: OTHER_PERSON.aadObjectId,
    teamsUserId: OTHER_PERSON.teamsUserId,
    displayName: OTHER_PERSON.displayName,
    conversationReference: makeConversationRef(
      OTHER_CONVERSATION_ID,
      OTHER_PERSON
    ),
  });
}

/**
 * The row an earlier attempt at THIS message would have left behind.
 * Built with the real key builder rather than a literal, so a test that
 * seeds a prior attempt cannot disagree with the dispatcher about which
 * delivery it is seeding.
 */
function outcomeOf(
  message: NotificationMessage,
  status: DeliveryStatus
): NotificationLogEntry {
  return makeNotificationLogEntry({
    prKey: message.prKey,
    dedupeKey: dedupeKey(message),
    status,
    recipientEmail: message.recipient.email,
    recipientDisplayName: message.recipient.displayName,
  });
}

describe("NotificationDispatcher", () => {
  it("sends a reviewer the round-opened card as a 1:1 DM", async () => {
    const { dispatcher, sender } = await withInstalled(makeCapturedIdentity());

    await dispatcher.dispatch(makeNotificationMessage({ event: "roundOpened" }));

    // The card is asserted as the reviewer builder's output rather than as
    // hand-written JSON: the builders are already pinned to the frozen
    // handoff design by their own tests, so re-stating that shape here
    // would only duplicate it. What this slice owns is WHICH card an
    // event selects, and where it lands.
    expect(sender.sends).toEqual([
      {
        conversationReference: makeConversationRef(),
        card: reviewerCard(CARD_CONTENT),
      },
    ]);
  });

  it("sends the author the round-closed card as a 1:1 DM", async () => {
    const { dispatcher, sender } = await withInstalled(makeCapturedIdentity());

    await dispatcher.dispatch(makeNotificationMessage({ event: "roundClosed" }));

    // The "safe to proceed" signal — the one message this whole product
    // exists to deliver, and the one that must never read as another
    // request to act.
    expect(sender.sends).toEqual([
      {
        conversationReference: makeConversationRef(),
        card: authorCard(CARD_CONTENT),
      },
    ]);
  });

  it("delivers to the addressed person's own chat, not another teammate's", async () => {
    const { dispatcher, sender } = await withInstalled(
      makeCapturedIdentity(),
      otherPersonIdentity()
    );

    await dispatcher.dispatch(
      makeNotificationMessage({
        recipient: {
          adoId: OTHER_PERSON.aadObjectId,
          email: OTHER_PERSON.email,
          displayName: OTHER_PERSON.displayName,
        },
      })
    );

    expect(sender.sends).toEqual([
      expect.objectContaining({
        conversationReference: makeConversationRef(
          OTHER_CONVERSATION_ID,
          OTHER_PERSON
        ),
      }),
    ]);
  });

  it("reaches a person whose email ADO spells with different case", async () => {
    // ADO's `uniqueName`, Teams' `userPrincipalName` and a hand-typed
    // override all mean one person and disagree about case. Casing must
    // not be what decides whether somebody is reachable.
    const { dispatcher, sender } = await withInstalled(makeCapturedIdentity());

    await dispatcher.dispatch(
      makeNotificationMessage({
        recipient: {
          adoId: PERSON.aadObjectId,
          email: "  Dana.Reviewer@Contoso.COM  ",
          displayName: PERSON.displayName,
        },
      })
    );

    expect(sender.sends).toEqual([
      expect.objectContaining({ conversationReference: makeConversationRef() }),
    ]);
  });

  it("renders each card from its own message, never from a shared round", async () => {
    // Both messages name the same PR, the same round number and the same
    // event, and carry different content — only the recipient differs, as
    // in a fan-out. The bot holds no Rounds table to consult, and this is
    // what says so: if any card field came from a round rather than from
    // the message, these two DMs could not differ.
    const { dispatcher, sender } = await withInstalled(
      makeCapturedIdentity(),
      otherPersonIdentity()
    );

    const first = makeNotificationMessage({
      card: { ...CARD_CONTENT, roundLabel: "Round 2 — Spec Review" },
    });
    const second = makeNotificationMessage({
      recipient: {
        adoId: OTHER_RECIPIENT_ADO_ID,
        email: OTHER_PERSON.email,
        displayName: OTHER_PERSON.displayName,
      },
      card: { ...CARD_CONTENT, roundLabel: "Round 2 — Implementation Review" },
    });

    await dispatcher.dispatch(first);
    await dispatcher.dispatch(second);

    expect(sender.sends.map((send) => send.card)).toEqual([
      reviewerCard(first.card),
      reviewerCard(second.card),
    ]);
  });

  it("records `sent`, naming who was reached and when", async () => {
    const { dispatcher, log } = await withInstalled(makeCapturedIdentity());
    const message = makeNotificationMessage();

    await dispatcher.dispatch(message);

    // The recipient rides along with the outcome so that "who was
    // notified for round 4" is answerable from the rows after the fact;
    // an ADO identity GUID on its own answers nothing anybody can read.
    // The address is recorded as the message spelled it — the row key is
    // built from the ADO id, so casing cannot split one person in two.
    expect(log.writes).toEqual([
      {
        prKey: message.prKey,
        dedupeKey: dedupeKey(message),
        status: "sent",
        recipientEmail: message.recipient.email,
        recipientDisplayName: message.recipient.displayName,
        at: expect.stringMatching(ISO_TIMESTAMP) as unknown as string,
      },
    ]);
  });

  it("sends nothing when this person was already sent this round's DM", async () => {
    // The redelivery the whole log exists for. At-least-once means the
    // queue can hand the same message back after a successful send, and
    // the common case has to come out exactly-once.
    const message = makeNotificationMessage();
    const { dispatcher, sender, log } = await makeHarness({
      installed: [makeCapturedIdentity()],
      log: makeNotificationLog(outcomeOf(message, "sent")),
    });

    await dispatcher.dispatch(message);

    expect(sender.sends).toEqual([]);
    expect(log.writes).toEqual([]);
  });

  it("sends nothing when this person was already found unreachable", async () => {
    // `no-identity` is settled, not pending: the person never installed
    // the bot, and re-resolving them on every redelivery would spend the
    // retry budget re-learning a fact already written down.
    const message = makeNotificationMessage();
    const { dispatcher, sender, log } = await makeHarness({
      installed: [makeCapturedIdentity()],
      log: makeNotificationLog(outcomeOf(message, "no-identity")),
    });

    await dispatcher.dispatch(message);

    expect(sender.sends).toEqual([]);
    expect(log.writes).toEqual([]);
  });

  it("still attempts a delivery that failed before", async () => {
    // A `failed` row is a record, not a suppression. It is the ONLY
    // outcome a retry can improve on, so treating it like `sent` would
    // turn every transient Teams error into a permanently lost DM.
    const message = makeNotificationMessage({ event: "roundClosed" });
    const { dispatcher, sender, log } = await makeHarness({
      installed: [makeCapturedIdentity()],
      log: makeNotificationLog(outcomeOf(message, "failed")),
    });

    await dispatcher.dispatch(message);

    expect(sender.sends).toEqual([
      expect.objectContaining({ card: authorCard(message.card) }),
    ]);
    expect(log.writes).toEqual([
      expect.objectContaining({ status: "sent" }) as unknown as NotificationLogEntry,
    ]);
  });

  it("does not let one round's delivery suppress the next round's", async () => {
    // Same PR, same person, same event — only the round differs. A round
    // 3 that went quiet because round 2 was delivered is this product
    // failing at the one thing it does.
    const delivered = makeNotificationMessage({ roundNumber: 2 });
    const { dispatcher, sender } = await makeHarness({
      installed: [makeCapturedIdentity()],
      log: makeNotificationLog(outcomeOf(delivered, "sent")),
    });

    await dispatcher.dispatch(makeNotificationMessage({ roundNumber: 3 }));

    expect(sender.sends).toHaveLength(1);
  });

  it("records `no-identity` for someone who never installed the bot, and does not fail", async () => {
    // Unreachable is a logged fact, not an error: there is no
    // conversation to open, and throwing would spend the retry budget
    // re-learning that and end in the poison queue. Nothing is wrong, and
    // the round does not care.
    const { dispatcher, sender, log } = await withInstalled(makeCapturedIdentity());
    const message = makeNotificationMessage({
      recipient: {
        adoId: "11112222-3333-4444-5555-666677778888",
        email: STRANGER_EMAIL,
        displayName: "Morgan Bystander",
      },
    });

    await expect(dispatcher.dispatch(message)).resolves.toBeUndefined();

    expect(sender.sends).toEqual([]);
    expect(log.writes).toEqual([
      {
        prKey: message.prKey,
        dedupeKey: dedupeKey(message),
        status: "no-identity",
        recipientEmail: STRANGER_EMAIL,
        recipientDisplayName: "Morgan Bystander",
        at: expect.stringMatching(ISO_TIMESTAMP) as unknown as string,
      },
    ]);
  });

  it("completes a message whose schema version it does not recognise, without sending", async () => {
    // The compatibility contract between two packages that share no
    // compiler and no deploy. A version this build cannot read is
    // terminal: retrying will not make it readable, and a future schema
    // change should degrade quietly rather than cycle a whole round's
    // fan-out through the poison queue.
    const { dispatcher, sender, log } = await withInstalled(makeCapturedIdentity());

    await expect(
      dispatcher.dispatch(makeNotificationMessage({ schemaVersion: 2 }))
    ).resolves.toBeUndefined();

    expect(sender.sends).toEqual([]);

    // Nothing is recorded either: if the envelope cannot be read, neither
    // can the round, event and recipient the row would be keyed by, and a
    // row keyed off an unreadable message could suppress a real delivery.
    expect(log.writes).toEqual([]);
  });

  it("treats a recipient with no resolvable email as unreachable, not as a failure", async () => {
    // No address means no retry can ever succeed — but nothing was
    // attempted, so this is the same outcome as never having installed
    // the bot rather than a delivery that went wrong.
    for (const email of UNRESOLVABLE_EMAILS) {
      const { dispatcher, sender, log } = await withInstalled(makeCapturedIdentity());
      const message = makeNotificationMessage({
        recipient: { ...makeNotificationMessage().recipient, email },
      });

      await expect(
        dispatcher.dispatch(message),
        `${JSON.stringify(email)} was handed back to the queue to retry forever`
      ).resolves.toBeUndefined();

      expect(sender.sends).toEqual([]);
      expect(log.writes).toEqual([
        expect.objectContaining({
          dedupeKey: dedupeKey(message),
          status: "no-identity",
        }) as unknown as NotificationLogEntry,
      ]);
    }
  });

  it("records `failed` and rethrows when Teams refuses the send", async () => {
    // Transient: a Bot Framework or network error escapes so the host
    // retries with backoff and eventually poisons, which turns a Teams
    // outage into delayed notifications instead of dropped ones. The row
    // is written first — check → send → mark — so the attempt is on the
    // record even though the invocation ends in an exception.
    const failure = new Error("Bot Framework: 503 Service Unavailable");
    const message = makeNotificationMessage({ event: "roundClosed" });
    const { dispatcher, sender, log } = await makeHarness({
      installed: [makeCapturedIdentity()],
      sender: makeFailingTeamsSender(failure),
    });

    await expect(dispatcher.dispatch(message)).rejects.toThrow(failure);

    expect(sender.sends).toHaveLength(1);
    expect(log.writes).toEqual([
      expect.objectContaining({
        dedupeKey: dedupeKey(message),
        status: "failed",
      }) as unknown as NotificationLogEntry,
    ]);
  });

  it("delivers the DM on the retry after a Teams outage", async () => {
    // The whole guarantee, end to end: duplicates over drops. The first
    // attempt fails and leaves a `failed` row; the queue hands the same
    // message back; the second attempt is not suppressed by that row and
    // the author gets their "safe to proceed" late rather than never.
    const message = makeNotificationMessage({ event: "roundClosed" });
    const installed = [makeCapturedIdentity()];
    const log = makeNotificationLog();

    const outage = await makeHarness({
      installed,
      log,
      sender: makeFailingTeamsSender(new Error("ETIMEDOUT")),
    });
    await expect(outage.dispatcher.dispatch(message)).rejects.toThrow();

    const retry = await makeHarness({ installed, log });
    await retry.dispatcher.dispatch(message);

    expect(retry.sender.sends).toEqual([
      expect.objectContaining({ card: authorCard(message.card) }),
    ]);
    expect(await log.get(message.prKey, dedupeKey(message))).toEqual(
      expect.objectContaining({ status: "sent" })
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  createNotificationDispatcher,
  type NotificationDispatcher,
} from "./NotificationDispatcher";
import { createIdentityDirectory } from "../IdentityDirectory/IdentityDirectory";
import { authorCard, reviewerCard } from "../../cards";
import type { CapturedIdentity } from "../../lib";
import {
  makeIdentityRepository,
  makeTeamsSender,
  type RecordingTeamsSender,
} from "../../test/fixtures/fakes";
import {
  CARD_CONTENT,
  OTHER_CONVERSATION_ID,
  OTHER_PERSON,
  PERSON,
  STRANGER_EMAIL,
  makeCapturedIdentity,
  makeConversationRef,
  makeNotificationMessage,
} from "../../test/fixtures/fixtures";

// The deepest module in the feature: one message in, one DM out. This
// slice is its happy path — resolve the recipient, pick the card their
// event calls for, send it to their own chat.
//
// Driven end-to-end against a REAL `IdentityDirectory` over the in-memory
// repository and a recording `TeamsSender`, mirroring how
// `packages/api`'s `RoundService.test.ts` runs against a real repository
// fake. That is what makes "an address ADO spells differently still
// reaches the right person" a fact about delivery rather than a fact
// about a mock's return value — and, because the sender is the only seam
// Bot Framework lives behind, there is no `botbuilder` in this file at
// all.
//
// Dedupe, outcome logging and the terminal/transient split are the next
// slice's (#21). Nothing here asserts a `NotificationLog`.

interface Harness {
  dispatcher: NotificationDispatcher;
  sender: RecordingTeamsSender;
}

/** A dispatcher whose directory holds exactly the people named. */
async function withInstalled(
  ...identities: CapturedIdentity[]
): Promise<Harness> {
  const directory = createIdentityDirectory(makeIdentityRepository());
  for (const identity of identities) await directory.capture(identity);

  const sender = makeTeamsSender();
  return { dispatcher: createNotificationDispatcher(directory, sender), sender };
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
    // Both messages name the same PR and the same round number, and carry
    // different content. The bot holds no Rounds table to consult, and
    // this is what says so: if any card field came from a round rather
    // than from the message, these two DMs could not differ.
    const { dispatcher, sender } = await withInstalled(makeCapturedIdentity());

    const first = makeNotificationMessage({
      card: { ...CARD_CONTENT, roundLabel: "Round 2 — Spec Review" },
    });
    const second = makeNotificationMessage({
      card: { ...CARD_CONTENT, roundLabel: "Round 2 — Implementation Review" },
    });

    await dispatcher.dispatch(first);
    await dispatcher.dispatch(second);

    expect(sender.sends.map((send) => send.card)).toEqual([
      reviewerCard(first.card),
      reviewerCard(second.card),
    ]);
  });

  it("sends nothing, and does not fail, for someone who never installed the bot", async () => {
    // Unreachable is a logged fact, not an error: a person who never
    // sideloaded PRSync has no conversation reference, and retrying would
    // teach nothing. Recording that outcome as `no-identity` is the next
    // slice's job — what this one owns is that the message completes
    // quietly instead of throwing into the retry budget.
    const { dispatcher, sender } = await withInstalled(makeCapturedIdentity());

    await expect(
      dispatcher.dispatch(
        makeNotificationMessage({
          recipient: {
            adoId: "11112222-3333-4444-5555-666677778888",
            email: STRANGER_EMAIL,
            displayName: "Morgan Bystander",
          },
        })
      )
    ).resolves.toBeUndefined();

    expect(sender.sends).toEqual([]);
  });
});

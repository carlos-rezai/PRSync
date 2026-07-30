import { describe, it, expect } from "vitest";
import { createTeamsSender } from "./TeamsSender";
import { reviewerCard } from "../../cards";
import { makeProactiveConversationOpener } from "../../test/fixtures/fakes";
import {
  CARD_CONTENT,
  makeConversationRef,
} from "../../test/fixtures/fixtures";

// The last module in the package to get a test, and it was last for a
// reason: it took a concrete `CloudAdapter`, so there was no way to drive
// it without standing up Bot Framework. The seam that makes every other
// module testable was itself the one thing that could not be tested.
// Narrowing the parameter to `ProactiveConversationOpener` — one named
// method — is what closed that, and it is the same trick `QueueProducer`
// plays on the Azure queue client in `packages/api`.
//
// What is asserted is what the seam promises, and nothing about Bot
// Framework's own behaviour: that the stored reference is handed over
// as-is, that the bot's app id goes with it, and that the card lands as an
// attachment. Everything about WHICH card and WHOSE chat is decided above
// this line and belongs to the dispatcher's test.
//
// The card is the real builder's output rather than hand-written JSON. The
// builders are already pinned to the frozen handoff design by their own
// tests, so restating it here would duplicate a contract rather than check
// one.

const APP_ID = "6f5e4d3c-2b1a-0908-1716-2524232221f0";

/** The adaptive-card content type Teams renders a card from. */
const ADAPTIVE_CARD = "application/vnd.microsoft.card.adaptive";

describe("the Teams sender", () => {
  it("opens the proactive turn against the stored reference, unmodified", async () => {
    const adapter = makeProactiveConversationOpener();
    const reference = makeConversationRef();

    await createTeamsSender(adapter, APP_ID).send(
      reference,
      reviewerCard(CARD_CONTENT)
    );

    // Asserted by identity, not by shape. PRSync's reference type is
    // deliberately all-optional — it is whatever the SDK handed back at
    // install, held opaque — and reconstructing it field by field is
    // exactly the reading-into the design forbids. A sender that rebuilt
    // it would pass a field-by-field assertion and silently drop whatever
    // field a future Teams adds.
    expect(adapter.continuations[0]?.reference).toBe(reference);
  });

  it("authenticates the turn as the bot", async () => {
    const adapter = makeProactiveConversationOpener();

    await createTeamsSender(adapter, APP_ID).send(
      makeConversationRef(),
      reviewerCard(CARD_CONTENT)
    );

    // Nobody is mid-turn when a round opens, so there is no inbound
    // activity to reply to and nothing to inherit an identity from. The
    // app id is what makes the manufactured turn the bot's.
    expect(adapter.continuations[0]?.botAppId).toBe(APP_ID);
  });

  it("posts the card as an attachment, not as text", async () => {
    const adapter = makeProactiveConversationOpener();
    const card = reviewerCard(CARD_CONTENT);

    await createTeamsSender(adapter, APP_ID).send(makeConversationRef(), card);

    // A card sent as text arrives as a wall of JSON in someone's chat.
    // This is the difference between the product working and it being
    // unreadable, and it is one factory call away from wrong.
    const [activity] = adapter.continuations[0]?.activities ?? [];
    expect(activity?.attachments).toEqual([
      { contentType: ADAPTIVE_CARD, content: card },
    ]);
    expect(activity?.text ?? "").toBe("");
  });

  it("sends exactly one message per DM", async () => {
    const adapter = makeProactiveConversationOpener();

    await createTeamsSender(adapter, APP_ID).send(
      makeConversationRef(),
      reviewerCard(CARD_CONTENT)
    );

    // One queued notification message is one DM to one person. A second
    // activity here would double every notification the product sends,
    // and the dispatcher — which counts sends, not activities — could not
    // see it.
    expect(adapter.continuations).toHaveLength(1);
    expect(adapter.continuations[0]?.activities).toHaveLength(1);
  });
});

import {
  CardFactory,
  CloudAdapter,
  MessageFactory,
  TurnContext,
  type ConversationReference,
} from "botbuilder";
import type { AdaptiveCard, ConversationRef } from "../../lib";

// The seam, not the logic. One operation — put this card in that chat —
// which is the whole reason `NotificationDispatcher` can be driven
// end-to-end with no Bot Framework and no Teams in its test at all.
// Everything about WHICH card and WHOSE chat is decided above this line;
// everything below it is a vendor call.

export interface TeamsSender {
  /** Post a card into a captured 1:1 conversation. */
  send(
    conversationReference: ConversationRef,
    card: AdaptiveCard
  ): Promise<void>;
}

/**
 * Sends through the adapter, proactively: nobody is mid-turn when a
 * round opens, so there is no inbound activity to reply to.
 * `continueConversationAsync` is what manufactures the turn — it
 * authenticates as the bot and resumes the stored reference as if the
 * conversation had just spoken.
 */
export function createTeamsSender(
  adapter: CloudAdapter,
  appId: string
): TeamsSender {
  return {
    send(
      conversationReference: ConversationRef,
      card: AdaptiveCard
    ): Promise<void> {
      return adapter.continueConversationAsync(
        appId,
        // PRSync's own reference type is deliberately all-optional — it
        // is whatever the SDK handed back at install, held opaque and
        // never read into outside this layer. Asserted rather than
        // reconstructed field by field, because reconstructing it is
        // exactly the reading-into the design forbids.
        conversationReference as Partial<ConversationReference>,
        async (context: TurnContext): Promise<void> => {
          await context.sendActivity(
            MessageFactory.attachment(CardFactory.adaptiveCard(card))
          );
        }
      );
    },
  };
}

import { authorCard, reviewerCard } from "../../cards";
import type {
  AdaptiveCard,
  CardContent,
  NotificationEvent,
  NotificationMessage,
} from "../../lib";
import type { TeamsSender } from "../../teams";
import type { IdentityDirectory } from "../IdentityDirectory/IdentityDirectory";

// The deepest module in the feature: one message in, one DM out. Every
// rule about what a notification means — which card, whose chat, what an
// unreachable recipient costs — is behind this single function of a
// single argument, which is why the queue-triggered function above it
// can be four lines.
//
// `TeamsSender` is imported for its TYPE only, so nothing here loads
// `teams/` — and therefore nothing here loads `botbuilder`. The port is
// declared beside its Bot Framework implementation because that is the
// one place it is implemented for real; the dependency is on the shape,
// and it is erased at compile time.
//
// Dedupe, outcome logging and the terminal/transient split are the next
// slice's. This one is the happy path.

/** Which card an event calls for. The whole of card selection. */
const CARD_FOR: Record<
  NotificationEvent,
  (content: CardContent) => AdaptiveCard
> = {
  roundOpened: reviewerCard,
  roundClosed: authorCard,
};

export interface NotificationDispatcher {
  /** Deliver one queued notification message as a personal 1:1 DM. */
  dispatch(message: NotificationMessage): Promise<void>;
}

export function createNotificationDispatcher(
  directory: IdentityDirectory,
  sender: TeamsSender
): NotificationDispatcher {
  return {
    async dispatch(message: NotificationMessage): Promise<void> {
      const identity = await directory.resolve(message.recipient.email);

      // Somebody who never sideloaded PRSync has no conversation to open.
      // That is a fact to record, not an error to raise: throwing would
      // spend the retry budget re-learning it and end in the poison
      // queue. Recording it as `no-identity` is the next slice's job.
      if (identity === null) return;

      // Every field comes from the message. The bot holds no Rounds
      // table, so what the card says is what was true at enqueue time —
      // which is what a DM read an hour later has to say.
      await sender.send(
        identity.conversationReference,
        CARD_FOR[message.event](message.card)
      );
    },
  };
}

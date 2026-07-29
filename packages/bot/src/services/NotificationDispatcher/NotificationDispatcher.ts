import { authorCard, reviewerCard } from "../../cards";
import {
  dedupeKey,
  normalizeEmail,
  type AdaptiveCard,
  type CardContent,
  type DeliveryStatus,
  type NotificationEvent,
  type NotificationMessage,
} from "../../lib";
import type { NotificationLogRepository } from "../../storage";
import type { TeamsSender } from "../../teams";
import type { IdentityDirectory } from "../IdentityDirectory/IdentityDirectory";

// The deepest module in the feature: one message in, one DM out. Every
// rule about what a notification means — which card, whose chat, what an
// unreachable recipient costs, what is worth retrying — is behind this
// single function of a single argument, which is why the queue-triggered
// function above it can be four lines.
//
// `TeamsSender` is imported for its TYPE only, so nothing here loads
// `teams/` — and therefore nothing here loads `botbuilder`. The port is
// declared beside its Bot Framework implementation because that is the
// one place it is implemented for real; the dependency is on the shape,
// and it is erased at compile time.
//
// Delivery is ordered check → send → mark and at-least-once by deliberate
// choice: the narrow window where a send succeeds and the mark fails
// yields a duplicate DM on redelivery rather than a lost one. Duplicates
// over drops — a missing "safe to proceed" is the exact failure this
// product exists to prevent.
//
// Every outcome is terminal or transient and nothing else. Terminal —
// an unreadable envelope, an unreachable recipient — returns normally so
// the host completes the message; retrying teaches nothing. Transient —
// Bot Framework, the network — escapes, so the host retries with backoff
// and eventually poisons, turning a Teams outage into delayed
// notifications rather than dropped ones.

/** Which card an event calls for. The whole of card selection. */
const CARD_FOR: Record<
  NotificationEvent,
  (content: CardContent) => AdaptiveCard
> = {
  roundOpened: reviewerCard,
  roundClosed: authorCard,
};

/**
 * The message schema this build can read. `packages/api` and
 * `packages/bot` share no compiler and no deploy, so the version on the
 * envelope is the whole of the contract between them.
 */
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * The outcomes that settle a delivery. A `failed` row is deliberately not
 * among them: it is the only outcome a retry can improve on, so treating
 * it like `sent` would turn every transient Teams error into a
 * permanently lost DM.
 */
const SETTLED: readonly DeliveryStatus[] = ["sent", "no-identity"];

export interface NotificationDispatcher {
  /** Deliver one queued notification message as a personal 1:1 DM. */
  dispatch(message: NotificationMessage): Promise<void>;
}

export function createNotificationDispatcher(
  directory: IdentityDirectory,
  sender: TeamsSender,
  log: NotificationLogRepository
): NotificationDispatcher {
  return {
    async dispatch(message: NotificationMessage): Promise<void> {
      // A version this build cannot read is terminal, and nothing is
      // recorded either: if the envelope cannot be read, neither can the
      // round, event and recipient the row would be keyed by, and a row
      // keyed off an unreadable message could suppress a real delivery
      // later.
      if (message.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return;

      const key = dedupeKey(message);
      const attempted = await log.get(message.prKey, key);
      if (attempted !== null && SETTLED.includes(attempted.status)) return;

      const record = (status: DeliveryStatus): Promise<void> =>
        log.record({
          prKey: message.prKey,
          dedupeKey: key,
          status,
          // As the message spelled it: the row key is built from the ADO
          // id, so casing cannot split one person in two, and a human
          // reading the row wants the address they know.
          recipientEmail: message.recipient.email,
          recipientDisplayName: message.recipient.displayName,
          at: new Date().toISOString(),
        });

      // Somebody who never sideloaded PRSync has no conversation to open,
      // and an address that normalizes to nothing can never be looked up
      // by any retry. Both are facts to record, not errors to raise:
      // throwing would spend the retry budget re-learning them and end in
      // the poison queue. Nothing is wrong, and the round does not care.
      const address = normalizeEmail(message.recipient.email);
      const identity = address === "" ? null : await directory.resolve(address);
      if (identity === null) {
        await record("no-identity");
        return;
      }

      try {
        // Every field comes from the message. The bot holds no Rounds
        // table, so what the card says is what was true at enqueue time —
        // which is what a DM read an hour later has to say.
        await sender.send(
          identity.conversationReference,
          CARD_FOR[message.event](message.card)
        );
      } catch (error) {
        // The attempt goes on the record before the failure escapes, so a
        // delivery the host is still retrying is visible rather than
        // invisible until it succeeds.
        await record("failed");
        throw error;
      }

      await record("sent");
    },
  };
}

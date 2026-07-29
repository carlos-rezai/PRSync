import type { NotificationMessage } from "../types/types";

// Delivery is at-least-once by deliberate choice, so the same message can
// arrive twice, and this is the only thing that says the second one is
// the same DM. Everything about dedupe rests on the key: too coarse and a
// round-closed DM is swallowed by an unrelated round-opened one; too fine
// and every redelivery is a duplicate.
//
// The PR is NOT in the key — it is the partition the record lives in,
// which is what keeps round 2 on one PR from suppressing round 2 on every
// other.
//
// It is built from the identity of the delivery and never from the card:
// what identifies a DM is who is owed what, not what it says. A key that
// moved with the content would never suppress anything.

/**
 * The row key of a message's delivery record, within its `prKey`
 * partition: `{roundNumber}|{event}|{recipientAdoId}`.
 *
 * The recipient is the ADO identity id rather than the email, so the
 * casing one producer happens to send cannot split one person's record in
 * two.
 */
export function dedupeKey(message: NotificationMessage): string {
  return `${message.roundNumber}|${message.event}|${message.recipient.adoId}`;
}

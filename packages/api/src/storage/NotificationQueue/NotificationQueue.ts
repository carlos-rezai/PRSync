import { QueueClient } from "@azure/storage-queue";

// The other thing this layer owns an Azure SDK for. `@azure/storage-queue`
// stays inside `storage/` for the same reason `@azure/data-tables` does:
// `services/` owns the fan-out RULES — who gets a message and how many —
// and those are only testable against a fake if no Azure SDK is reachable
// from that layer. The notification producer is the obvious place to
// construct a `QueueClient` "just to send with", and doing so would leave
// it undrivable without a storage account.

/**
 * The queue as everything above this layer sees it: somewhere to put a
 * message. Deliberately the whole surface — the producer sends and does
 * nothing else, and a narrower type is what makes a fake one line.
 */
export interface NotificationQueue {
  sendMessage(messageText: string): Promise<unknown>;
}

/**
 * The queue the bot's trigger listens on, in the given account. The
 * composition root asks for this rather than a `QueueClient`, so the SDK
 * stays inside this layer — otherwise the rule would hold for every layer
 * except the one that assembles them all.
 *
 * The queue itself is provisioned with the storage account, not created
 * here: this runs at host start, where there is nothing to await, and a
 * queue the producer conjures on first send is one the bot's trigger has
 * already spent its startup failing to find.
 *
 * A malformed connection string throws here, at host start and next to
 * the setting that caused it, rather than surfacing later as one silently
 * undelivered DM at a time.
 */
export function createNotificationQueue(
  connectionString: string,
  queueName: string
): NotificationQueue {
  return new QueueClient(connectionString, queueName);
}

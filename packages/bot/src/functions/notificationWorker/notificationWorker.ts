import type {
  InvocationContext,
  StorageQueueTriggerOptions,
} from "@azure/functions";
import type { NotificationMessage } from "../../lib";
import type { NotificationDispatcher } from "../../services";

// Thin queue entry point, for the same reason `teamsMessages` is a thin
// HTTP one: every rule about what a notification message means lives
// behind `NotificationDispatcher`. This module hands one message over
// and returns.
//
// Returning normally completes the queue message; throwing hands it back
// to the host to retry and eventually poison. That split is the whole of
// this layer's error handling, and deciding which failures fall on which
// side is the dispatcher's job, not this one's.

/** The queue name used when nothing is configured. */
const DEFAULT_QUEUE_NAME = "prsync-notifications";

/**
 * The app setting holding the queue's connection string when nothing is
 * configured — the NAME of a setting, not a connection string, which is
 * what the Functions binding expects.
 */
const DEFAULT_CONNECTION_SETTING = "AZURE_QUEUES_CONNECTION_STRING";

/**
 * Where the worker listens. Both halves are settings so the two Function
 * Apps can share one storage account or split it: `packages/api` writes
 * to a queue it names, and the bot has to be able to be pointed at the
 * same one without a rebuild.
 */
export function notificationWorkerOptions(
  env: Record<string, string | undefined>
): StorageQueueTriggerOptions {
  return {
    queueName: env.PRSYNC_NOTIFICATION_QUEUE_NAME ?? DEFAULT_QUEUE_NAME,
    connection:
      env.PRSYNC_NOTIFICATION_QUEUE_CONNECTION ?? DEFAULT_CONNECTION_SETTING,
  };
}

/**
 * The queue entry, as a message.
 *
 * The host deserializes an entry it recognises as JSON and hands the
 * rest over as text. Which one arrives is a property of the host and of
 * the producer's encoding — not of the message — so both are read the
 * same way rather than letting a runtime detail nobody controls from
 * here decide whether a DM is sent.
 *
 * Asserted, not validated: `schemaVersion` carries the compatibility
 * contract between the two packages, and checking it is the next
 * slice's terminal-failure rule.
 */
function toMessage(queueEntry: unknown): NotificationMessage {
  return (
    typeof queueEntry === "string" ? JSON.parse(queueEntry) : queueEntry
  ) as NotificationMessage;
}

export function makeNotificationWorkerHandler(
  dispatcher: NotificationDispatcher
) {
  return function notificationWorker(
    queueEntry: unknown,
    _context: InvocationContext
  ): Promise<void> {
    return dispatcher.dispatch(toMessage(queueEntry));
  };
}

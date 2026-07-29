import { TableClient, type TableEntity } from "@azure/data-tables";
import type { DeliveryStatus, NotificationLogEntry } from "../../lib";

// The delivery record, and the only reason a redelivered message can come
// out exactly-once. Like `TeamsIdentityRepository` next door, this layer
// is the ONLY one that touches @azure/data-tables, and every access is a
// point read/write by exact partition + row key: `PartitionKey` is the PR
// key and `RowKey` is the dedupe key, so there is no query to build and no
// value that arrived from the queue ever reaches a filter.
//
// Partitioned by PR key on purpose: round numbers restart per PR — round 2
// exists on every PR in the org at once — so a key without the PR in it
// would let one PR's round-2 DM suppress every other PR's.
//
// An absent row is the go-ahead to send, which is why `get` answers null
// for a 404 rather than raising: "not yet delivered" and "storage broke"
// are opposite instructions to the caller.

export interface NotificationLogRepository {
  /** The outcome of this delivery, or null if it was never attempted. */
  get(prKey: string, dedupeKey: string): Promise<NotificationLogEntry | null>;
  /** Write this delivery's outcome, replacing any earlier attempt's. */
  record(entry: NotificationLogEntry): Promise<void>;
}

const TABLE_NAME = "NotificationLog";

type NotificationLogEntity = TableEntity<{
  status: DeliveryStatus;
  recipientEmail: string;
  recipientDisplayName: string;
  at: string;
}>;

function toEntity(entry: NotificationLogEntry): NotificationLogEntity {
  return {
    partitionKey: entry.prKey,
    rowKey: entry.dedupeKey,
    status: entry.status,
    recipientEmail: entry.recipientEmail,
    recipientDisplayName: entry.recipientDisplayName,
    at: entry.at,
  };
}

function toEntry(entity: NotificationLogEntity): NotificationLogEntry {
  return {
    // Both keys are the identity of the delivery; storing either twice
    // would let the two copies disagree.
    prKey: entity.partitionKey,
    dedupeKey: entity.rowKey,
    status: entity.status,
    recipientEmail: entity.recipientEmail,
    recipientDisplayName: entity.recipientDisplayName,
    at: entity.at,
  };
}

export class TableStorageNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly client: TableClient) {}

  async get(
    prKey: string,
    dedupeKey: string
  ): Promise<NotificationLogEntry | null> {
    try {
      const entity = await this.client.getEntity<NotificationLogEntity>(
        prKey,
        dedupeKey
      );
      return toEntry(entity);
    } catch (error) {
      // No attempt was made — the caller's cue to send, and a different
      // fact from storage being unavailable.
      if (statusCodeOf(error) === 404) return null;
      throw error;
    }
  }

  async record(entry: NotificationLogEntry): Promise<void> {
    // Replace, not Merge: one delivery leaves one row whatever it took, so
    // a retry's outcome overwrites the attempt it retried rather than
    // landing beside it.
    await this.client.upsertEntity(toEntity(entry), "Replace");
  }
}

/**
 * The repository over the `NotificationLog` table of the given account.
 * The composition root asks for this rather than a `TableClient`, so
 * `@azure/data-tables` stays inside this layer.
 */
export function createNotificationLogRepository(
  connectionString: string
): NotificationLogRepository {
  return new TableStorageNotificationLogRepository(
    TableClient.fromConnectionString(connectionString, TABLE_NAME)
  );
}

// The @azure/data-tables SDK surfaces HTTP faults as RestError-shaped
// objects carrying a numeric `statusCode`; read it structurally so the
// repository stays the only layer coupled to the SDK.
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code: unknown = error.statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

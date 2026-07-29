import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TableClient } from "@azure/data-tables";
import { TableStorageNotificationLogRepository } from "./NotificationLogRepository";
import { dedupeKey } from "../../lib";
import {
  DEDUPE_KEY,
  OTHER_PR_KEY,
  OTHER_PERSON,
  OTHER_RECIPIENT_ADO_ID,
  PR_KEY,
  makeNotificationLogEntry,
  makeNotificationMessage,
} from "../../test/fixtures/fixtures";

// Integration test against the Azurite emulator, exactly like
// `TeamsIdentityRepository.test.ts` next door. Start it with `npx azurite`
// before running.
//
// This layer is the ONLY one that touches @azure/data-tables. Access is a
// point read/write by exact partition + row key — `PartitionKey` is the
// PR key and `RowKey` is the dedupe key — so there is no query to build
// and no value that arrived from the queue ever reaches a filter.
//
// It runs against the real emulator rather than a fake table client
// because everything worth knowing here is Table Storage's own
// behaviour: that a `|`-joined dedupe key is a legal row key, that a
// second write of the same key replaces rather than duplicates, and that
// reading an absent row is a 404 rather than an empty result. An absent
// row is the difference between "not yet delivered" and "already sent",
// so a fake that asserted those assumptions back at itself would be
// asserting the one thing dedupe depends on.

const AZURITE_CONN =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

const TABLE_NAME = `notificationlog${Date.now()}`;

let client: TableClient;
let repo: TableStorageNotificationLogRepository;

beforeAll(async () => {
  client = TableClient.fromConnectionString(AZURITE_CONN, TABLE_NAME, {
    allowInsecureConnection: true,
  });
  await client.createTable();
  repo = new TableStorageNotificationLogRepository(client);
});

afterAll(async () => {
  await client.deleteTable();
});

describe("TableStorageNotificationLogRepository", () => {
  it("records an outcome and reads it back whole", async () => {
    const entry = makeNotificationLogEntry();
    await repo.record(entry);

    // Who was addressed rides along with the outcome: "who was notified
    // for round 4" has to be answerable from the rows themselves.
    expect(await repo.get(entry.prKey, entry.dedupeKey)).toEqual(entry);
  });

  it("returns null for a delivery that was never attempted", async () => {
    // The absent row IS the go-ahead to send. If storage answered
    // anything other than "no attempt was made" here, the very first DM
    // of a round would be suppressed as a duplicate of itself.
    expect(await repo.get(PR_KEY, `99|roundClosed|${OTHER_RECIPIENT_ADO_ID}`)).toBeNull();
  });

  it("replaces the earlier outcome when the same delivery is attempted again", async () => {
    const dedupe = `7|roundClosed|${OTHER_RECIPIENT_ADO_ID}`;
    await repo.record(
      makeNotificationLogEntry({
        dedupeKey: dedupe,
        status: "failed",
        at: "2026-07-28T09:00:00.000Z",
      })
    );

    const succeeded = makeNotificationLogEntry({
      dedupeKey: dedupe,
      status: "sent",
      at: "2026-07-28T09:05:00.000Z",
    });
    await repo.record(succeeded);

    // A retry's outcome overwrites the attempt it retried rather than
    // landing beside it — one delivery, one row, whatever it took.
    expect(await repo.get(PR_KEY, dedupe)).toEqual(succeeded);
  });

  it("keeps one reviewer's outcome apart from another's on the same round", async () => {
    const message = makeNotificationMessage({ roundNumber: 4 });
    const other = makeNotificationMessage({
      roundNumber: 4,
      recipient: {
        adoId: OTHER_RECIPIENT_ADO_ID,
        email: OTHER_PERSON.email,
        displayName: OTHER_PERSON.displayName,
      },
    });

    await repo.record(
      makeNotificationLogEntry({ dedupeKey: dedupeKey(message), status: "sent" })
    );
    await repo.record(
      makeNotificationLogEntry({
        dedupeKey: dedupeKey(other),
        status: "no-identity",
        recipientEmail: OTHER_PERSON.email,
        recipientDisplayName: OTHER_PERSON.displayName,
      })
    );

    // A fan-out of five must leave five rows. One reviewer's `sent`
    // standing in for the rest would send exactly one DM per round.
    const read = await repo.get(PR_KEY, dedupeKey(message));
    expect(read?.status).toBe("sent");
    expect(read?.recipientEmail).not.toBe(OTHER_PERSON.email);
  });

  it("keeps the same round number on two PRs apart", async () => {
    // Round 2 exists on every PR in the org at once. The PR key is the
    // partition precisely so those rounds cannot collide — otherwise one
    // PR's round-2 DM would suppress every other PR's.
    await repo.record(makeNotificationLogEntry({ prKey: PR_KEY, status: "sent" }));

    expect(await repo.get(OTHER_PR_KEY, DEDUPE_KEY)).toBeNull();
  });
});

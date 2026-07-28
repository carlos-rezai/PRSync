import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TableClient } from "@azure/data-tables";
import { TableStorageTeamsIdentityRepository } from "./TeamsIdentityRepository";
import { PERSON, STRANGER_EMAIL, makeTeamsIdentity } from "../../test/fixtures/fixtures";

// Integration test against the Azurite emulator, exactly like
// `packages/api/src/storage/RoundRepository/RoundRepository.test.ts`.
// Start it with `npx azurite` before running.
//
// This layer is the ONLY one that touches @azure/data-tables. Access is a
// point read/write by exact partition + row key: the row key IS the
// normalized email, so there is no query to build and no user input ever
// reaches a filter. The repository stores what it is given — normalizing
// the address is IdentityDirectory's job, hidden behind its three verbs —
// so nothing here asserts anything about case.
//
// It runs against the real emulator rather than a fake table client
// because everything worth knowing here is Table Storage's own
// behaviour: that an email is a legal row key, that a second write of the
// same key replaces rather than duplicates, and that reading an absent
// row is a 404 rather than an empty result. A fake would only assert
// those assumptions back at itself.

const AZURITE_CONN =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

const TABLE_NAME = `teamsidentities${Date.now()}`;

let client: TableClient;
let repo: TableStorageTeamsIdentityRepository;

beforeAll(async () => {
  client = TableClient.fromConnectionString(AZURITE_CONN, TABLE_NAME, {
    allowInsecureConnection: true,
  });
  await client.createTable();
  repo = new TableStorageTeamsIdentityRepository(client);
});

afterAll(async () => {
  await client.deleteTable();
});

describe("TableStorageTeamsIdentityRepository", () => {
  it("persists an identity and reads it back with its conversation reference intact", async () => {
    const identity = makeTeamsIdentity();
    await repo.upsert(identity);

    const read = await repo.get(PERSON.email);
    expect(read).not.toBeNull();
    expect(read).toEqual(identity);

    // The conversation reference is the whole point of the row: it is the
    // handle the bot opens a 1:1 DM with, and it survives the round trip
    // as the serialized form it was stored as, byte for byte.
    expect(read?.conversationReference).toBe(identity.conversationReference);
    expect(JSON.parse(read?.conversationReference ?? "null")).toEqual(
      JSON.parse(identity.conversationReference)
    );
  });

  it("returns null for someone who never installed the app", async () => {
    // Unreachable is a fact, not a fault: the caller has to be able to
    // tell "no identity" from "storage broke", and an absent row is the
    // former.
    expect(await repo.get(STRANGER_EMAIL)).toBeNull();
  });

  it("replaces the stored reference when the same person is captured again", async () => {
    const email = "refresh.target@contoso.com";
    await repo.upsert(
      makeTeamsIdentity({
        email,
        conversationReference: JSON.stringify({ conversation: { id: "a:stale" } }),
        updatedAt: "2026-07-27T09:00:00.000Z",
      })
    );

    const refreshed = makeTeamsIdentity({
      email,
      conversationReference: JSON.stringify({ conversation: { id: "a:current" } }),
      updatedAt: "2026-07-28T09:00:00.000Z",
      displayName: "Dana Reviewer-Smith",
    });
    await repo.upsert(refreshed);

    // A second install, or any later activity, must overwrite the row
    // rather than land beside it — a stale reference that survives is a
    // person whose notifications quietly stop.
    expect(await repo.get(email)).toEqual(refreshed);
  });

  it("deletes an identity, after which the person is no longer known", async () => {
    const email = "uninstaller@contoso.com";
    await repo.upsert(makeTeamsIdentity({ email }));
    expect(await repo.get(email)).not.toBeNull();

    await repo.delete(email);

    // PRSync holds a conversation reference exactly as long as the person
    // has the app installed.
    expect(await repo.get(email)).toBeNull();
  });

  it("deleting someone who was never captured is not an error", async () => {
    // Teams can deliver the uninstall event for a conversation PRSync
    // never captured — a redelivery, or an install that failed halfway.
    // Refusing it would poison a message over an outcome that is already
    // what was wanted.
    await expect(repo.delete(STRANGER_EMAIL)).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TableClient } from "@azure/data-tables";
import { TableStorageRoundRepository } from "./RoundRepository";
import type { Round } from "../lib/types";

// Integration test against the Azurite emulator (per the PRD). Start it
// with `npx azurite` before running. The repository is the ONLY layer
// that touches @azure/data-tables: point reads/writes by exact keys,
// `reviewers` (de)serialized as JSON, "no round" surfaces as null.

const AZURITE_CONN =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

const TABLE_NAME = `rounds${Date.now()}`;
const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

let client: TableClient;
let repo: TableStorageRoundRepository;

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    prKey: PR_KEY,
    roundNumber: 1,
    phase: "implementation",
    label: "Round 1 — Implementation Review",
    status: "open",
    quorum: 2,
    reviewers: [
      {
        adoId: "r1",
        email: "r1@example.com",
        displayName: "Reviewer One",
        isRequired: false,
        done: false,
        teamsIdOverride: null,
      },
      {
        adoId: "r2",
        email: "r2@example.com",
        displayName: "Reviewer Two",
        isRequired: false,
        done: true,
        doneAt: "2026-07-24T10:00:00.000Z",
        teamsIdOverride: null,
      },
    ],
    prTitle: "Add round lifecycle",
    prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
    authorAdoId: "author-ado-id",
    authorName: "The Author",
    authorEmail: "author@example.com",
    openedAt: "2026-07-24T09:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

beforeAll(async () => {
  client = TableClient.fromConnectionString(AZURITE_CONN, TABLE_NAME, {
    allowInsecureConnection: true,
  });
  await client.createTable();
  repo = new TableStorageRoundRepository(client);
});

afterAll(async () => {
  await client.deleteTable();
});

describe("TableStorageRoundRepository", () => {
  it("persists a round and reads it back with its reviewer list intact", async () => {
    const round = makeRound();
    await repo.createRound(round);

    const read = await repo.getCurrentRound(PR_KEY);
    expect(read).not.toBeNull();
    expect(read).toMatchObject({
      prKey: PR_KEY,
      roundNumber: 1,
      phase: "implementation",
      status: "open",
      quorum: 2,
      schemaVersion: 1,
    });
    // reviewers survive the JSON round-trip as a typed array, not a string.
    expect(read?.reviewers).toEqual(round.reviewers);
  });

  it("getCurrentRound returns the highest round number regardless of status", async () => {
    const prKey =
      "11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222:7";
    await repo.createRound(
      makeRound({ prKey, roundNumber: 1, status: "closed" })
    );
    await repo.createRound(
      makeRound({ prKey, roundNumber: 2, status: "cancelled" })
    );
    await repo.createRound(
      makeRound({ prKey, roundNumber: 3, status: "open" })
    );

    const current = await repo.getCurrentRound(prKey);
    expect(current?.roundNumber).toBe(3);
    expect(current?.status).toBe("open");
  });

  it("getCurrentRound returns null for a PR that has never had a round", async () => {
    const unknown =
      "99999999-9999-9999-9999-999999999999:88888888-8888-8888-8888-888888888888:1";
    expect(await repo.getCurrentRound(unknown)).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoundService, RoundServiceError } from "./RoundService";
import type { NotificationPort } from "./NotificationPort";
import type { RoundRepository } from "../storage/RoundRepository";
import type { IncomingReviewer, Round } from "../lib/types";

// Behavioural tests over the RoundService public interface, exercised
// against an in-memory RoundRepository fake and a spy NotificationPort
// (per the PRD: "real Azurite or an in-memory fake"). We assert what the
// lifecycle DOES — server-owned fields, guards, the fired notification —
// never how it computes them.

const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

class InMemoryRoundRepository implements RoundRepository {
  private byPr = new Map<string, Round[]>();

  async getCurrentRound(prKey: string): Promise<Round | null> {
    const rounds = this.byPr.get(prKey) ?? [];
    if (rounds.length === 0) return null;
    return structuredClone(
      rounds.reduce((a, b) => (b.roundNumber > a.roundNumber ? b : a))
    );
  }

  async createRound(round: Round): Promise<Round> {
    const rounds = this.byPr.get(round.prKey) ?? [];
    rounds.push(structuredClone(round));
    this.byPr.set(round.prKey, rounds);
    return structuredClone(round);
  }

  // Test-only seeding helper (not part of the interface).
  seed(round: Round): void {
    const rounds = this.byPr.get(round.prKey) ?? [];
    rounds.push(structuredClone(round));
    this.byPr.set(round.prKey, rounds);
  }
}

function incoming(overrides: Partial<IncomingReviewer> = {}): IncomingReviewer {
  return {
    adoId: "reviewer-1",
    email: "r1@example.com",
    displayName: "Reviewer One",
    isRequired: false,
    isContainer: false,
    ...overrides,
  };
}

const AUTHOR = {
  adoId: "author-ado-id",
  name: "The Author",
  email: "author@example.com",
};

function openInput(
  overrides: Partial<Parameters<RoundService["openRound"]>[1]> = {}
) {
  return {
    phase: "implementation" as const,
    reviewers: [incoming({ adoId: "r1" }), incoming({ adoId: "r2" })],
    prTitle: "Add round lifecycle",
    prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
    author: AUTHOR,
    ...overrides,
  };
}

function seedRound(overrides: Partial<Round>): Round {
  return {
    prKey: PR_KEY,
    roundNumber: 1,
    phase: "spec",
    label: "Round 1 — Spec Review",
    status: "closed",
    quorum: 2,
    reviewers: [],
    prTitle: "Add round lifecycle",
    prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
    authorAdoId: AUTHOR.adoId,
    authorName: AUTHOR.name,
    authorEmail: AUTHOR.email,
    openedAt: "2026-07-24T09:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

let repo: InMemoryRoundRepository;
let notifications: NotificationPort;

beforeEach(() => {
  repo = new InMemoryRoundRepository();
  notifications = {
    roundOpened: vi.fn().mockResolvedValue(undefined),
    roundClosed: vi.fn().mockResolvedValue(undefined),
  };
});

function service(defaultQuorum = 2): RoundService {
  return new RoundService({ repository: repo, notifications, defaultQuorum });
}

describe("RoundService.openRound", () => {
  it("persists an open round with server-owned number, status, timestamp, and quorum", async () => {
    const round = await service().openRound(PR_KEY, openInput());

    expect(round).toMatchObject({
      prKey: PR_KEY,
      roundNumber: 1,
      status: "open",
      quorum: 2,
      phase: "implementation",
      schemaVersion: 1,
    });
    expect(Number.isNaN(Date.parse(round.openedAt))).toBe(false);
    expect(round.closedAt).toBeUndefined();
    expect(round.cancelledAt).toBeUndefined();

    // Actually committed to storage.
    const current = await repo.getCurrentRound(PR_KEY);
    expect(current?.roundNumber).toBe(1);
    expect(current?.status).toBe("open");
  });

  it("derives the round number from the latest round of any status", async () => {
    repo.seed(seedRound({ roundNumber: 3, status: "cancelled" }));

    const round = await service().openRound(PR_KEY, openInput());

    expect(round.roundNumber).toBe(4);
  });

  it("freezes the phase from the request and auto-generates a label when none is given", async () => {
    const round = await service().openRound(
      PR_KEY,
      openInput({ phase: "spec" })
    );

    expect(round.phase).toBe("spec");
    expect(round.label).toBe("Round 1 — Spec Review");
  });

  it("honors a client-supplied label at open", async () => {
    const round = await service().openRound(
      PR_KEY,
      openInput({ label: "Final polish pass" })
    );

    expect(round.label).toBe("Final polish pass");
  });

  it("snapshots reviewers, dropping containers and the author", async () => {
    const round = await service().openRound(
      PR_KEY,
      openInput({
        reviewers: [
          incoming({ adoId: "r1" }),
          incoming({ adoId: "r2" }),
          incoming({ adoId: "team", isContainer: true }),
          incoming({ adoId: AUTHOR.adoId }),
        ],
      })
    );

    expect(round.reviewers.map((r) => r.adoId)).toEqual(["r1", "r2"]);
    expect(round.reviewers.every((r) => r.done === false)).toBe(true);
  });

  it("snapshots the quorum in force at open time", async () => {
    const round = await service(3).openRound(
      PR_KEY,
      openInput({
        reviewers: [
          incoming({ adoId: "r1" }),
          incoming({ adoId: "r2" }),
          incoming({ adoId: "r3" }),
        ],
      })
    );

    expect(round.quorum).toBe(3);
  });

  it("refuses to open when a round is already open (ROUND_ALREADY_OPEN)", async () => {
    repo.seed(seedRound({ roundNumber: 2, status: "open" }));

    await expect(
      service().openRound(PR_KEY, openInput())
    ).rejects.toMatchObject({
      code: "ROUND_ALREADY_OPEN",
    });
    await expect(
      service().openRound(PR_KEY, openInput())
    ).rejects.toBeInstanceOf(RoundServiceError);

    // Nothing new committed, nothing notified.
    expect((await repo.getCurrentRound(PR_KEY))?.roundNumber).toBe(2);
    expect(notifications.roundOpened).not.toHaveBeenCalled();
  });

  it("refuses to open when tracked individuals are fewer than the quorum (INSUFFICIENT_REVIEWERS)", async () => {
    await expect(
      service(2).openRound(
        PR_KEY,
        openInput({ reviewers: [incoming({ adoId: "r1" })] })
      )
    ).rejects.toMatchObject({ code: "INSUFFICIENT_REVIEWERS" });

    expect(await repo.getCurrentRound(PR_KEY)).toBeNull();
    expect(notifications.roundOpened).not.toHaveBeenCalled();
  });

  it("fires roundOpened exactly once, after the round is committed", async () => {
    let committedAtNotifyTime: Round | null = null;
    notifications.roundOpened = vi.fn(async () => {
      committedAtNotifyTime = await repo.getCurrentRound(PR_KEY);
    });

    const round = await service().openRound(PR_KEY, openInput());

    expect(notifications.roundOpened).toHaveBeenCalledTimes(1);
    expect(notifications.roundOpened).toHaveBeenCalledWith(
      expect.objectContaining({ prKey: PR_KEY, roundNumber: round.roundNumber })
    );
    // Post-commit: the round already existed in storage when the port fired.
    expect(committedAtNotifyTime).not.toBeNull();
  });

  it("isolates a notification failure — the open still succeeds and is committed", async () => {
    notifications.roundOpened = vi
      .fn()
      .mockRejectedValue(new Error("bot is down"));

    const round = await service().openRound(PR_KEY, openInput());

    expect(round.status).toBe("open");
    expect((await repo.getCurrentRound(PR_KEY))?.roundNumber).toBe(
      round.roundNumber
    );
  });
});

describe("RoundService.getCurrentRound", () => {
  it("returns the latest round of any status", async () => {
    repo.seed(seedRound({ roundNumber: 1, status: "closed" }));
    repo.seed(seedRound({ roundNumber: 2, status: "cancelled" }));

    const current = await service().getCurrentRound(PR_KEY);

    expect(current?.roundNumber).toBe(2);
    expect(current?.status).toBe("cancelled");
  });

  it("returns null for a PR that has never had a round", async () => {
    expect(await service().getCurrentRound(PR_KEY)).toBeNull();
  });
});

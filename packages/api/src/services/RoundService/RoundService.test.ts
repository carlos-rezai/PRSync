import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoundService, RoundServiceError } from "./RoundService";
import type { NotificationPort } from "../NotificationPort/NotificationPort";
import { PreconditionFailedError, type RoundRepository } from "../../storage";
import type { IncomingReviewer, Round, RoundReviewer } from "../../lib";
import type { Faked } from "../../test/fixtures/fakes";

// Behavioural tests over the RoundService public interface, exercised
// against an in-memory RoundRepository fake and a spy NotificationPort
// (per the PRD: "real Azurite or an in-memory fake"). We assert what the
// lifecycle DOES — server-owned fields, guards, the fired notification —
// never how it computes them.

const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

class InMemoryRoundRepository implements RoundRepository {
  private byPr = new Map<string, Round[]>();
  private etags = new Map<string, string>();

  // Test controls for simulating optimistic-concurrency contention.
  onBeforeUpdate: (() => void) | null = null;
  failAllUpdates = false;
  updateCalls = 0;

  private rowKey(prKey: string, roundNumber: number): string {
    return `${prKey}#${roundNumber}`;
  }

  private bump(prKey: string, roundNumber: number): string {
    const key = this.rowKey(prKey, roundNumber);
    const next = String(Number(this.etags.get(key) ?? "0") + 1);
    this.etags.set(key, next);
    return next;
  }

  // None of these await anything — the store is a Map. They return
  // promises rather than being declared `async`, so that the signatures
  // still honour the interface without claiming an await that never
  // happens. Failures reject rather than throwing synchronously, which
  // is what the real repository does and what the service's retry loop
  // is written against.

  getCurrentRound(prKey: string): Promise<Round | null> {
    const rounds = this.byPr.get(prKey) ?? [];
    if (rounds.length === 0) return Promise.resolve(null);
    return Promise.resolve(
      structuredClone(
        rounds.reduce((a, b) => (b.roundNumber > a.roundNumber ? b : a))
      )
    );
  }

  createRound(round: Round): Promise<Round> {
    const rounds = this.byPr.get(round.prKey) ?? [];
    rounds.push(structuredClone(round));
    this.byPr.set(round.prKey, rounds);
    this.bump(round.prKey, round.roundNumber);
    return Promise.resolve(structuredClone(round));
  }

  getRound(
    prKey: string,
    roundNumber: number
  ): Promise<{ round: Round; etag: string } | null> {
    const rounds = this.byPr.get(prKey) ?? [];
    const found = rounds.find((r) => r.roundNumber === roundNumber);
    if (found === undefined) return Promise.resolve(null);
    return Promise.resolve({
      round: structuredClone(found),
      etag: this.etags.get(this.rowKey(prKey, roundNumber))!,
    });
  }

  updateRound(
    round: Round,
    etag: string
  ): Promise<{ round: Round; etag: string }> {
    this.updateCalls++;
    if (this.failAllUpdates) {
      return Promise.reject(new PreconditionFailedError());
    }

    // A one-shot hook lets a test inject a competing write (bumping the
    // ETag) between our read and our conditional write.
    if (this.onBeforeUpdate !== null) {
      const hook = this.onBeforeUpdate;
      this.onBeforeUpdate = null;
      hook();
    }

    const key = this.rowKey(round.prKey, round.roundNumber);
    if (this.etags.get(key) !== etag) {
      return Promise.reject(new PreconditionFailedError());
    }

    const rounds = this.byPr.get(round.prKey)!;
    const idx = rounds.findIndex((r) => r.roundNumber === round.roundNumber);
    rounds[idx] = structuredClone(round);
    const nextEtag = this.bump(round.prKey, round.roundNumber);
    return Promise.resolve({ round: structuredClone(round), etag: nextEtag });
  }

  // Test-only seeding helper (not part of the interface).
  seed(round: Round): void {
    const rounds = this.byPr.get(round.prKey) ?? [];
    rounds.push(structuredClone(round));
    this.byPr.set(round.prKey, rounds);
    this.bump(round.prKey, round.roundNumber);
  }

  // Test-only: simulate a competing writer that has already closed the
  // round, invalidating any outstanding ETag.
  forceClose(prKey: string, roundNumber: number): void {
    const rounds = this.byPr.get(prKey) ?? [];
    const found = rounds.find((r) => r.roundNumber === roundNumber);
    if (found === undefined) return;
    found.status = "closed";
    found.closedAt = "2026-07-24T11:00:00.000Z";
    this.bump(prKey, roundNumber);
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
// `Faked` rather than `NotificationPort`, so the two spies are mock
// PROPERTIES: a test can assert on `notifications.roundOpened` without
// tearing a method off the port it belongs to.
let notifications: Faked<NotificationPort>;

beforeEach(() => {
  repo = new InMemoryRoundRepository();
  notifications = {
    roundOpened: vi.fn(() => Promise.resolve()),
    roundClosed: vi.fn(() => Promise.resolve()),
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
    notifications.roundOpened.mockImplementation(async () => {
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
    notifications.roundOpened.mockRejectedValue(new Error("bot is down"));

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

function rvwr(overrides: Partial<RoundReviewer> = {}): RoundReviewer {
  return {
    adoId: "r1",
    email: "r1@example.com",
    displayName: "Reviewer One",
    isRequired: false,
    done: false,
    teamsIdOverride: null,
    ...overrides,
  };
}

function seedOpenRound(reviewers: RoundReviewer[], quorum = 2): Round {
  const round = seedRound({
    roundNumber: 1,
    status: "open",
    quorum,
    reviewers,
  });
  repo.seed(round);
  return round;
}

describe("RoundService.toggleDone", () => {
  it("sets only the caller's own Done state and returns the updated round", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);

    const updated = await service().toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r1",
      done: true,
    });

    const r1 = updated.reviewers.find((r) => r.adoId === "r1");
    const r2 = updated.reviewers.find((r) => r.adoId === "r2");
    expect(r1?.done).toBe(true);
    expect(typeof r1?.doneAt).toBe("string");
    expect(r2?.done).toBe(false); // never touched by another caller
    expect(updated.status).toBe("open");
  });

  it("refuses a caller who is not a snapshotted reviewer (NOT_A_REVIEWER)", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);

    const attempt = () =>
      service().toggleDone(PR_KEY, {
        roundNumber: 1,
        callerAdoId: "stranger",
        done: true,
      });

    await expect(attempt()).rejects.toMatchObject({ code: "NOT_A_REVIEWER" });
    await expect(attempt()).rejects.toBeInstanceOf(RoundServiceError);
  });

  it("refuses a toggle on a non-open round (ROUND_NOT_OPEN) and does not notify", async () => {
    repo.seed(
      seedRound({
        roundNumber: 1,
        status: "closed",
        reviewers: [rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })],
      })
    );

    await expect(
      service().toggleDone(PR_KEY, {
        roundNumber: 1,
        callerAdoId: "r1",
        done: true,
      })
    ).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });
    expect(notifications.roundClosed).not.toHaveBeenCalled();
  });

  it("is idempotent — re-marking Done yields the same state as a single mark", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);
    const svc = service();

    const once = await svc.toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r1",
      done: true,
    });
    const twice = await svc.toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r1",
      done: true,
    });

    expect(once.reviewers.find((r) => r.adoId === "r1")?.done).toBe(true);
    expect(twice.reviewers.find((r) => r.adoId === "r1")?.done).toBe(true);
    expect(twice.status).toBe("open");
  });

  it("allows un-marking Done while the round is open, clearing doneAt", async () => {
    seedOpenRound([
      rvwr({ adoId: "r1", done: true, doneAt: "2026-07-24T10:00:00.000Z" }),
      rvwr({ adoId: "r2" }),
    ]);

    const updated = await service().toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r1",
      done: false,
    });

    const r1 = updated.reviewers.find((r) => r.adoId === "r1");
    expect(r1?.done).toBe(false);
    expect(r1?.doneAt).toBeUndefined();
    expect(updated.status).toBe("open");
  });

  it("closes automatically when the quorum is reached, setting closedAt and firing roundClosed exactly once", async () => {
    seedOpenRound(
      [
        rvwr({ adoId: "r1", done: true, doneAt: "2026-07-24T10:00:00.000Z" }),
        rvwr({ adoId: "r2" }),
      ],
      2
    );

    const updated = await service().toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r2",
      done: true,
    });

    expect(updated.status).toBe("closed");
    expect(typeof updated.closedAt).toBe("string");
    expect(notifications.roundClosed).toHaveBeenCalledTimes(1);
    expect(notifications.roundClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        prKey: PR_KEY,
        roundNumber: 1,
        status: "closed",
      })
    );
    expect((await repo.getCurrentRound(PR_KEY))?.status).toBe("closed");
  });

  it("rejects a toggle arriving after the round has already closed (ROUND_NOT_OPEN) without re-firing the notification", async () => {
    seedOpenRound(
      [
        rvwr({ adoId: "r1", done: true, doneAt: "2026-07-24T10:00:00.000Z" }),
        rvwr({ adoId: "r2" }),
      ],
      2
    );
    const svc = service();

    await svc.toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r2",
      done: true,
    }); // reaches quorum → closes
    expect(notifications.roundClosed).toHaveBeenCalledTimes(1);

    await expect(
      svc.toggleDone(PR_KEY, { roundNumber: 1, callerAdoId: "r1", done: false })
    ).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });
    expect(notifications.roundClosed).toHaveBeenCalledTimes(1); // frozen; not re-fired
  });

  it("a toggle that loses the ETag race to a concurrent close observes closed and refuses without re-notifying", async () => {
    seedOpenRound(
      [
        rvwr({ adoId: "r1", done: true, doneAt: "2026-07-24T10:00:00.000Z" }),
        rvwr({ adoId: "r2" }),
      ],
      2
    );

    // A competing writer closes the round between our read and our
    // conditional write, invalidating our ETag exactly once.
    repo.onBeforeUpdate = () => repo.forceClose(PR_KEY, 1);

    await expect(
      service().toggleDone(PR_KEY, {
        roundNumber: 1,
        callerAdoId: "r2",
        done: true,
      })
    ).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });

    // The loser never fires the safety signal — the winner owns it exactly once.
    expect(notifications.roundClosed).not.toHaveBeenCalled();
  });

  it("retries on ETag precondition failures and surfaces CONCURRENCY_EXHAUSTED after the bound (3)", async () => {
    seedOpenRound(
      [rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" }), rvwr({ adoId: "r3" })],
      3
    );
    repo.failAllUpdates = true;

    await expect(
      service().toggleDone(PR_KEY, {
        roundNumber: 1,
        callerAdoId: "r1",
        done: true,
      })
    ).rejects.toMatchObject({ code: "CONCURRENCY_EXHAUSTED" });

    expect(repo.updateCalls).toBe(3);
  });

  it("isolates a roundClosed notification failure — the close still commits", async () => {
    seedOpenRound(
      [
        rvwr({ adoId: "r1", done: true, doneAt: "2026-07-24T10:00:00.000Z" }),
        rvwr({ adoId: "r2" }),
      ],
      2
    );
    notifications.roundClosed.mockRejectedValue(new Error("bot is down"));

    const updated = await service().toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r2",
      done: true,
    });

    expect(updated.status).toBe("closed");
    expect((await repo.getCurrentRound(PR_KEY))?.status).toBe("closed");
  });
});

describe("RoundService.cancelRound", () => {
  it("moves an open round to cancelled with a cancelledAt, returns it, and fires no notification", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);

    const cancelled = await service().cancelRound(PR_KEY, {
      roundNumber: 1,
      callerAdoId: AUTHOR.adoId,
    });

    expect(cancelled.status).toBe("cancelled");
    expect(typeof cancelled.cancelledAt).toBe("string");
    expect(Number.isNaN(Date.parse(cancelled.cancelledAt!))).toBe(false);
    // Cancelled and closed are distinct terminal states — a cancel never
    // stamps closedAt, and "closed" only ever means the safety signal fired.
    expect(cancelled.closedAt).toBeUndefined();

    expect((await repo.getCurrentRound(PR_KEY))?.status).toBe("cancelled");
    // Silent abandonment: neither notification fires.
    expect(notifications.roundOpened).not.toHaveBeenCalled();
    expect(notifications.roundClosed).not.toHaveBeenCalled();
  });

  it("refuses a non-author caller (NOT_AUTHOR), mutating and notifying nothing", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);

    const attempt = () =>
      service().cancelRound(PR_KEY, { roundNumber: 1, callerAdoId: "r1" });

    await expect(attempt()).rejects.toMatchObject({ code: "NOT_AUTHOR" });
    await expect(attempt()).rejects.toBeInstanceOf(RoundServiceError);

    expect((await repo.getCurrentRound(PR_KEY))?.status).toBe("open");
    expect(notifications.roundClosed).not.toHaveBeenCalled();
  });

  it("refuses cancelling a closed round (ROUND_NOT_OPEN)", async () => {
    repo.seed(seedRound({ roundNumber: 1, status: "closed" }));

    await expect(
      service().cancelRound(PR_KEY, {
        roundNumber: 1,
        callerAdoId: AUTHOR.adoId,
      })
    ).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });
  });

  it("refuses cancelling an already-cancelled round (ROUND_NOT_OPEN)", async () => {
    repo.seed(seedRound({ roundNumber: 1, status: "cancelled" }));

    await expect(
      service().cancelRound(PR_KEY, {
        roundNumber: 1,
        callerAdoId: AUTHOR.adoId,
      })
    ).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });
  });

  it("checks authorship before open-status — a non-author on a closed round still gets NOT_AUTHOR", async () => {
    repo.seed(seedRound({ roundNumber: 1, status: "closed" }));

    await expect(
      service().cancelRound(PR_KEY, { roundNumber: 1, callerAdoId: "r1" })
    ).rejects.toMatchObject({ code: "NOT_AUTHOR" });
  });

  it("frees the PR so the next round opens at lastRound + 1 after a cancel", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);
    const svc = service();

    await svc.cancelRound(PR_KEY, {
      roundNumber: 1,
      callerAdoId: AUTHOR.adoId,
    });
    const next = await svc.openRound(PR_KEY, openInput());

    expect(next.roundNumber).toBe(2);
    expect(next.status).toBe("open");
  });

  it("retries on ETag precondition failures and surfaces CONCURRENCY_EXHAUSTED after the bound (3)", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);
    repo.failAllUpdates = true;

    await expect(
      service().cancelRound(PR_KEY, {
        roundNumber: 1,
        callerAdoId: AUTHOR.adoId,
      })
    ).rejects.toMatchObject({ code: "CONCURRENCY_EXHAUSTED" });

    expect(repo.updateCalls).toBe(3);
  });
});

describe("RoundService.editLabel", () => {
  it("edits the label on an open round, returns it, and fires no notification", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);

    const updated = await service().editLabel(PR_KEY, {
      roundNumber: 1,
      callerAdoId: AUTHOR.adoId,
      label: "Round 1 — Final polish",
    });

    expect(updated.label).toBe("Round 1 — Final polish");
    expect(updated.status).toBe("open");
    expect((await repo.getCurrentRound(PR_KEY))?.label).toBe(
      "Round 1 — Final polish"
    );
    // A label edit is display-only — it never re-fires or alters a
    // notification already sent.
    expect(notifications.roundOpened).not.toHaveBeenCalled();
    expect(notifications.roundClosed).not.toHaveBeenCalled();
  });

  it("refuses a non-author caller (NOT_AUTHOR) and leaves the label unchanged", async () => {
    // seedRound's default label is "Round 1 — Spec Review".
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);

    await expect(
      service().editLabel(PR_KEY, {
        roundNumber: 1,
        callerAdoId: "r1",
        label: "hijacked",
      })
    ).rejects.toMatchObject({ code: "NOT_AUTHOR" });

    expect((await repo.getCurrentRound(PR_KEY))?.label).toBe(
      "Round 1 — Spec Review"
    );
  });

  it("refuses editing the label on a non-open round (ROUND_NOT_OPEN)", async () => {
    repo.seed(seedRound({ roundNumber: 1, status: "closed" }));

    await expect(
      service().editLabel(PR_KEY, {
        roundNumber: 1,
        callerAdoId: AUTHOR.adoId,
        label: "too late",
      })
    ).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });
  });

  it("checks authorship before open-status — a non-author editing a closed round gets NOT_AUTHOR", async () => {
    repo.seed(seedRound({ roundNumber: 1, status: "closed" }));

    await expect(
      service().editLabel(PR_KEY, {
        roundNumber: 1,
        callerAdoId: "r1",
        label: "nope",
      })
    ).rejects.toMatchObject({ code: "NOT_AUTHOR" });
  });

  it("retries on ETag precondition failures and surfaces CONCURRENCY_EXHAUSTED after the bound (3)", async () => {
    seedOpenRound([rvwr({ adoId: "r1" }), rvwr({ adoId: "r2" })]);
    repo.failAllUpdates = true;

    await expect(
      service().editLabel(PR_KEY, {
        roundNumber: 1,
        callerAdoId: AUTHOR.adoId,
        label: "x",
      })
    ).rejects.toMatchObject({ code: "CONCURRENCY_EXHAUSTED" });

    expect(repo.updateCalls).toBe(3);
  });
});

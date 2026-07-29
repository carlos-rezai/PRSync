import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  QueueNotificationPort,
  type NotificationMessage,
  type QueueProducer,
} from "./QueueNotificationPort";
import { RoundService } from "../RoundService/RoundService";
import type { RoundRepository } from "../../storage";
import type {
  IncomingReviewer,
  Round,
  RoundReviewer,
} from "../../lib";
import { PR_KEY } from "../../test/fixtures/fixtures";

// Behavioural tests over the producing half of the notification path —
// the slice where a committed round transition becomes queued work.
//
// The port is driven through its public interface (`roundOpened` /
// `roundClosed`, the two methods `NotificationPort` declares) against a
// fake queue. Nothing here imports `@azure/storage-queue`: the real
// `QueueClient` is built in `storage/`, and what `services/` holds is a
// structural `QueueProducer` that a `QueueClient` happens to satisfy.
// That is the same trick the bot plays with `TeamsSender` for
// `botbuilder`, and it is why the fan-out rules are testable with no
// Azure SDK, no queue and no network anywhere in the file.
//
// What the port owns is entirely about COUNT and ADDRESSING: one message
// per tracked reviewer on open, exactly one to the author on close, none
// on cancel, and each one a self-contained snapshot rather than a
// reference to a round that may have moved on by the time it is read.
// See docs/design-logs/03-teams-notifications.md Q2 and Q4.

const AUTHOR = {
  adoId: "author-ado-id",
  name: "The Author",
  email: "author@example.com",
} as const;

/** A tracked reviewer as a round holds one, post-snapshot. */
function reviewer(
  adoId: string,
  overrides: Partial<RoundReviewer> = {}
): RoundReviewer {
  return {
    adoId,
    email: `${adoId}@example.com`,
    displayName: `Reviewer ${adoId}`,
    isRequired: true,
    done: false,
    teamsIdOverride: null,
    ...overrides,
  };
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    prKey: PR_KEY,
    roundNumber: 2,
    phase: "implementation",
    label: "Round 2 — Implementation Review",
    status: "open",
    quorum: 2,
    reviewers: [reviewer("r1"), reviewer("r2"), reviewer("r3")],
    prTitle: "Add round lifecycle",
    prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
    authorAdoId: AUTHOR.adoId,
    authorName: AUTHOR.name,
    authorEmail: AUTHOR.email,
    openedAt: "2026-07-29T09:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

interface FakeQueue {
  /** Every `messageText` handed to the queue, in order, exactly as sent. */
  readonly sent: string[];
  sendMessage: Mock<(messageText: string) => Promise<unknown>>;
}

/**
 * A queue that records what it was given. Not `async`: it awaits nothing,
 * and an `async` keyword over a synchronous body claims something the
 * function does not do (see `test/fixtures/fakes.ts`).
 */
function makeQueue(): FakeQueue {
  const sent: string[] = [];
  const sendMessage = vi.fn((messageText: string): Promise<unknown> => {
    sent.push(messageText);
    return Promise.resolve({ messageId: String(sent.length) });
  });
  return { sent, sendMessage };
}

/**
 * What the bot's queue trigger will hand its handler. The producer's job
 * is to make this decode step work; every assertion about content goes
 * through it rather than reading the wire format directly.
 */
function decode(messageText: string): NotificationMessage {
  return JSON.parse(
    Buffer.from(messageText, "base64").toString("utf8")
  ) as NotificationMessage;
}

function decodeAll(queue: FakeQueue): NotificationMessage[] {
  return queue.sent.map(decode);
}

let queue: FakeQueue;
let logError: Mock<(message: string, error: unknown) => void>;

beforeEach(() => {
  queue = makeQueue();
  logError = vi.fn();
});

function makePort(): QueueNotificationPort {
  return new QueueNotificationPort({ queue, logError });
}

describe("roundOpened — one message per tracked reviewer", () => {
  it("enqueues exactly one message per tracked reviewer, each addressed to that reviewer", async () => {
    const round = makeRound();

    await makePort().roundOpened(round);

    const messages = decodeAll(queue);
    expect(messages).toHaveLength(3);
    // One per reviewer, addressed to that reviewer — not one message per
    // round with a recipient list. Per-recipient granularity is what lets
    // the bot retry and poison one person without touching the others.
    expect(messages.map((message) => message.recipient)).toEqual([
      { adoId: "r1", email: "r1@example.com", displayName: "Reviewer r1" },
      { adoId: "r2", email: "r2@example.com", displayName: "Reviewer r2" },
      { adoId: "r3", email: "r3@example.com", displayName: "Reviewer r3" },
    ]);
    expect(messages.every((message) => message.event === "roundOpened")).toBe(
      true
    );
  });

  it("notifies an optional reviewer exactly as it notifies a required one", async () => {
    // Tracked is tracked. `isRequired` decides who GATES the close (the
    // gating set, docs/ubiquitous-language.md); it has never decided who
    // gets told a round opened, and silently dropping an optional
    // reviewer would leave them looking at a PR nobody told them about.
    const round = makeRound({
      reviewers: [
        reviewer("required-one", { isRequired: true }),
        reviewer("optional-one", { isRequired: false }),
      ],
    });

    await makePort().roundOpened(round);

    expect(decodeAll(queue).map((message) => message.recipient.adoId)).toEqual([
      "required-one",
      "optional-one",
    ]);
  });

  it("enqueues nothing for a round with no tracked reviewers", async () => {
    const round = makeRound({ reviewers: [] });

    await expect(makePort().roundOpened(round)).resolves.toBeUndefined();

    // Nothing to send is not a failure — the round is open and committed,
    // and the port's only job was to fan out to a set that is empty.
    expect(queue.sendMessage).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("notifies a lone reviewer like any other", async () => {
    const round = makeRound({ reviewers: [reviewer("only-one")] });

    await makePort().roundOpened(round);

    const messages = decodeAll(queue);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.recipient.adoId).toBe("only-one");
  });
});

describe("roundClosed — the author's safe-to-proceed signal", () => {
  it("enqueues exactly one message, addressed to the author", async () => {
    const round = makeRound({
      status: "closed",
      closedAt: "2026-07-29T10:00:00.000Z",
      reviewers: [
        reviewer("r1", { done: true }),
        reviewer("r2", { done: true }),
        reviewer("r3"),
      ],
    });

    await makePort().roundClosed(round);

    const messages = decodeAll(queue);
    // One message, to one person. The reviewers already had their DM when
    // the round opened; close is the author's signal that regenerating is
    // safe, and nobody else's.
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      event: "roundClosed",
      recipient: {
        adoId: AUTHOR.adoId,
        email: AUTHOR.email,
        displayName: AUTHOR.name,
      },
    });
  });
});

describe("the message the bot receives", () => {
  it("carries the label as it stands at the transition, not the one the round was generated with", async () => {
    // The author edits the label in the compose form before clicking
    // Ready for review. The DM is read minutes or hours later, and it has
    // to say what the author actually called the round.
    const round = makeRound({
      label: "Round 2 — Second pass at the payments use case",
      reviewers: [reviewer("r1")],
    });

    await makePort().roundOpened(round);

    expect(decodeAll(queue)[0]?.card.roundLabel).toBe(
      "Round 2 — Second pass at the payments use case"
    );
  });

  it("is a self-contained snapshot of the transition, never a reference to a round", async () => {
    const round = makeRound({ reviewers: [reviewer("r1")] });

    await makePort().roundOpened(round);

    // Deep equality, not a subset match: the bot holds no Rounds table, so
    // anything the card needs and this envelope omits is unreachable by
    // the time the message is read. An extra field is as much a contract
    // change as a missing one.
    expect(decodeAll(queue)[0]).toEqual({
      schemaVersion: 1,
      event: "roundOpened",
      prKey: PR_KEY,
      roundNumber: 2,
      recipient: {
        adoId: "r1",
        email: "r1@example.com",
        displayName: "Reviewer r1",
      },
      card: {
        roundLabel: "Round 2 — Implementation Review",
        prTitle: "Add round lifecycle",
        prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
        authorName: AUTHOR.name,
      },
    });
  });

  it("goes onto the queue base64-encoded, which is what the trigger decodes by default", async () => {
    // Verified against current documentation rather than assumed, because
    // getting it wrong produces a queue that fills and a bot that never
    // fires, with nothing red anywhere:
    //
    //   - The queue trigger's Usage note states it outright — "Functions
    //     expect a base64 encoded string. Any adjustments to the encoding
    //     type (in order to prepare data as a base64 encoded string) need
    //     to be implemented in the calling service."
    //     learn.microsoft.com/azure/azure-functions/functions-bindings-storage-queue-trigger
    //   - `QueueClient.sendMessage(messageText)` sends the text AS-IS. The
    //     JS SDK does no encoding on the producer's behalf, so "the
    //     calling service" above means exactly this class.
    //   - The `messageEncoding: "none"` opt-out is extension-bundle 5.0.0+
    //     only, and both host.json files pin `[4.*, 5.0.0)`. Opting out is
    //     not available to us even if we wanted it.
    const round = makeRound({ reviewers: [reviewer("r1")] });

    await makePort().roundOpened(round);

    const raw = queue.sent[0] ?? "";
    expect(raw).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // Raw JSON on the wire is the failure this pins: it is a perfectly
    // valid queue message that the trigger tries to base64-decode into
    // nonsense.
    expect(raw.startsWith("{")).toBe(false);
    expect(decode(raw).event).toBe("roundOpened");
    // Round-trips through the same two steps the worker uses.
    expect(Buffer.from(raw, "base64").toString("utf8")).toBe(
      JSON.stringify(decode(raw))
    );
  });
});

describe("a failure enqueuing one message", () => {
  it("logs it and continues to the rest", async () => {
    // A partial fan-out beats an aborted one: four people hearing about
    // the round is strictly better than two, and the fifth's failure is
    // the queue's to retry, not this loop's to escalate.
    const round = makeRound({
      reviewers: ["r1", "r2", "r3", "r4", "r5"].map((id) => reviewer(id)),
    });
    queue.sendMessage.mockImplementationOnce((text) => {
      queue.sent.push(text);
      return Promise.resolve({});
    });
    queue.sendMessage.mockImplementationOnce((text) => {
      queue.sent.push(text);
      return Promise.resolve({});
    });
    queue.sendMessage.mockImplementationOnce(() =>
      Promise.reject(new Error("queue is having a bad day"))
    );

    await expect(makePort().roundOpened(round)).resolves.toBeUndefined();

    expect(queue.sendMessage).toHaveBeenCalledTimes(5);
    expect(decodeAll(queue).map((message) => message.recipient.adoId)).toEqual([
      "r1",
      "r2",
      "r4",
      "r5",
    ]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("never rejects, so a committed round can never be rolled back by a notifier", async () => {
    // `RoundService` already isolates the port behind a try/catch. This is
    // the other half of the same promise, made where the failure actually
    // happens — a port that throws is relying on every future caller to
    // remember to swallow it.
    const round = makeRound();
    queue.sendMessage.mockRejectedValue(new Error("the whole queue is gone"));

    await expect(makePort().roundOpened(round)).resolves.toBeUndefined();
    await expect(makePort().roundClosed(round)).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(4);
  });
});

/**
 * A `RoundRepository` backed by a Map. Deliberately minimal — the
 * lifecycle rules themselves are `RoundService`'s tests to make; what
 * these need is a store that commits, so the real port can be driven by
 * the real transitions rather than by hand-built `Round` objects.
 */
class InMemoryRounds implements RoundRepository {
  private readonly rounds = new Map<string, Round>();
  private readonly etags = new Map<string, string>();

  private key(prKey: string, roundNumber: number): string {
    return `${prKey}#${roundNumber}`;
  }

  getCurrentRound(prKey: string): Promise<Round | null> {
    const forPr = [...this.rounds.values()].filter((r) => r.prKey === prKey);
    if (forPr.length === 0) return Promise.resolve(null);
    return Promise.resolve(
      structuredClone(
        forPr.reduce((a, b) => (b.roundNumber > a.roundNumber ? b : a))
      )
    );
  }

  createRound(round: Round): Promise<Round> {
    const key = this.key(round.prKey, round.roundNumber);
    this.rounds.set(key, structuredClone(round));
    this.etags.set(key, "1");
    return Promise.resolve(structuredClone(round));
  }

  getRound(
    prKey: string,
    roundNumber: number
  ): Promise<{ round: Round; etag: string } | null> {
    const key = this.key(prKey, roundNumber);
    const found = this.rounds.get(key);
    if (found === undefined) return Promise.resolve(null);
    return Promise.resolve({
      round: structuredClone(found),
      etag: this.etags.get(key) ?? "1",
    });
  }

  updateRound(
    round: Round,
    _etag: string
  ): Promise<{ round: Round; etag: string }> {
    const key = this.key(round.prKey, round.roundNumber);
    this.rounds.set(key, structuredClone(round));
    const next = String(Number(this.etags.get(key) ?? "0") + 1);
    this.etags.set(key, next);
    return Promise.resolve({ round: structuredClone(round), etag: next });
  }
}

function incoming(adoId: string): IncomingReviewer {
  return {
    adoId,
    email: `${adoId}@example.com`,
    displayName: `Reviewer ${adoId}`,
    isRequired: true,
    isContainer: false,
  };
}

describe("wired into the round lifecycle", () => {
  function makeService(): RoundService {
    return new RoundService({
      repository: new InMemoryRounds(),
      notifications: makePort(),
      defaultQuorum: 2,
    });
  }

  async function openThreeReviewerRound(service: RoundService): Promise<void> {
    await service.openRound(PR_KEY, {
      phase: "implementation",
      reviewers: [incoming("r1"), incoming("r2"), incoming("r3")],
      prTitle: "Add round lifecycle",
      prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
      callerAdoId: AUTHOR.adoId,
      author: { ...AUTHOR },
    });
  }

  it("produces the reviewers' messages on open and the author's on close", async () => {
    const service = makeService();

    await openThreeReviewerRound(service);
    await service.toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r1",
      done: true,
    });
    await service.toggleDone(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r2",
      done: true,
    });

    // Both transitions notified, in order, with the right count on each
    // side: three reviewers told a round opened, then one author told it
    // is safe to regenerate. The third reviewer's Done simply froze.
    expect(
      decodeAll(queue).map((message) => [
        message.event,
        message.recipient.adoId,
      ])
    ).toEqual([
      ["roundOpened", "r1"],
      ["roundOpened", "r2"],
      ["roundOpened", "r3"],
      ["roundClosed", AUTHOR.adoId],
    ]);
  });

  it("enqueues nothing when the author cancels", async () => {
    const service = makeService();

    await openThreeReviewerRound(service);
    const before = queue.sent.length;
    await service.cancelRound(PR_KEY, {
      roundNumber: 1,
      callerAdoId: AUTHOR.adoId,
    });

    // Cancelling is silent by design. A DM on cancel would read as the
    // "safe to proceed" signal for a round that reached no such thing —
    // which is the one thing this product exists not to get wrong.
    expect(queue.sent).toHaveLength(before);
    expect(
      decodeAll(queue).some((message) => message.event === "roundClosed")
    ).toBe(false);
  });
});

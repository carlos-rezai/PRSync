import type { Round, RoundReviewer } from "../../lib";
import type { NotificationPort } from "../NotificationPort/NotificationPort";

// The producing half of the notification path: a committed round
// transition becomes queued work, and nothing else. Who can actually be
// reached, what card they get and whether they have been told already are
// all the bot's questions — this side knows only COUNT and ADDRESSING.
//
// The queue is the entire boundary between the two Function Apps: they
// share no code and no synchronous call, so a bot that is down, slow or
// not yet deployed cannot affect a round. See
// docs/design-logs/03-teams-notifications.md, "Topology".

/**
 * The queue, as this layer needs it. Structural on purpose: `QueueClient`
 * from `@azure/storage-queue` satisfies it without knowing it exists,
 * which keeps the Azure SDK inside `storage/` and leaves every fan-out
 * rule below testable with no queue, no account and no network — the same
 * seam the bot uses for `botbuilder`.
 */
export interface QueueProducer {
  sendMessage(messageText: string): Promise<unknown>;
}

/** What happened on a round, and therefore which card it calls for. */
export type NotificationEvent = "roundOpened" | "roundClosed";

/** The one person a notification message is addressed to. */
export interface NotificationRecipient {
  /** The ADO identity id — the recipient half of the bot's dedupe key. */
  adoId: string;
  /** As ADO spells it; the bot owns normalizing it. */
  email: string;
  displayName: string;
}

/** Everything the card needs, as it stood at the transition. */
export interface CardContent {
  roundLabel: string;
  prTitle: string;
  prUrl: string;
  authorName: string;
}

/**
 * One queued unit of delivery: exactly one DM to exactly one person.
 * Never one message per round — per-recipient granularity is what lets
 * the bot retry and poison one person without touching the others.
 *
 * Self-contained and denormalized on purpose: the bot holds no Rounds
 * table, so anything the card needs and this envelope omits is
 * unreachable by the time the message is read, and a round that moves on
 * between enqueue and send cannot make a round-opened card render
 * post-close state.
 *
 * The producer's copy of the contract. `packages/bot` declares its own,
 * structurally narrower, and the two agree by `schemaVersion` rather than
 * by a shared compiler — nothing links the packages, and a message is
 * read by a build that may no longer be the one that wrote it.
 */
export interface NotificationMessage {
  schemaVersion: number;
  event: NotificationEvent;
  /** `{projectId}:{repositoryId}:{pullRequestId}`. */
  prKey: string;
  roundNumber: number;
  recipient: NotificationRecipient;
  card: CardContent;
}

/** The envelope version this producer writes. */
const SCHEMA_VERSION = 1;

export interface QueueNotificationPortDeps {
  queue: QueueProducer;
  /**
   * Where an enqueue failure goes. Injected rather than reached for: this
   * class is constructed at host start, outside any invocation, and a
   * port that picks its own logger is a port that cannot be driven in a
   * test without one.
   */
  logError: (message: string, error: unknown) => void;
}

export class QueueNotificationPort implements NotificationPort {
  private readonly queue: QueueProducer;
  private readonly logError: (message: string, error: unknown) => void;

  constructor(deps: QueueNotificationPortDeps) {
    this.queue = deps.queue;
    this.logError = deps.logError;
  }

  /**
   * One message per tracked reviewer, required and optional alike.
   * `isRequired` decides who GATES the close, never who is told a round
   * opened — see docs/ubiquitous-language.md, "Gating set".
   */
  async roundOpened(round: Round): Promise<void> {
    for (const reviewer of round.reviewers) {
      await this.enqueue(round, "roundOpened", recipientOf(reviewer));
    }
  }

  /**
   * One message, to the author. The reviewers already had theirs when the
   * round opened; close is the author's signal that regenerating is safe,
   * and nobody else's.
   */
  async roundClosed(round: Round): Promise<void> {
    await this.enqueue(round, "roundClosed", {
      adoId: round.authorAdoId,
      email: round.authorEmail,
      displayName: round.authorName,
    });
  }

  /**
   * Enqueues one message, swallowing whatever the queue does about it.
   *
   * Sequential and non-fatal: a failure on message 3 of 5 logs and the
   * loop continues, because a partial fan-out beats an aborted one. And
   * the round is already committed by the time any of this runs —
   * `RoundService` isolates the port behind a try/catch, and this is the
   * other half of the same promise, made where the failure happens
   * rather than relying on every future caller to remember to swallow it.
   */
  private async enqueue(
    round: Round,
    event: NotificationEvent,
    recipient: NotificationRecipient
  ): Promise<void> {
    const message: NotificationMessage = {
      schemaVersion: SCHEMA_VERSION,
      event,
      prKey: round.prKey,
      roundNumber: round.roundNumber,
      recipient,
      card: {
        // The label as it stands at the transition — the author edits it
        // before clicking Ready for review, and the DM is read later.
        roundLabel: round.label,
        prTitle: round.prTitle,
        prUrl: round.prUrl,
        authorName: round.authorName,
      },
    };

    try {
      await this.queue.sendMessage(encode(message));
    } catch (error) {
      // Correlate on the PR key and the ADO identity id — never an email
      // address, here or anywhere else in this package's logs.
      this.logError(
        `Enqueuing a ${event} notification failed [pr=${round.prKey}] [round=${String(round.roundNumber)}] [recipient=${recipient.adoId}]`,
        error
      );
    }
  }
}

function recipientOf(reviewer: RoundReviewer): NotificationRecipient {
  return {
    adoId: reviewer.adoId,
    email: reviewer.email,
    displayName: reviewer.displayName,
  };
}

/**
 * The message as it goes onto the wire: JSON, base64-encoded.
 *
 * Not a detail — getting it wrong produces a queue that fills and a bot
 * that never fires, with nothing red anywhere:
 *
 *   - The queue trigger's Usage note says it outright: "Functions expect
 *     a base64 encoded string. Any adjustments to the encoding type (in
 *     order to prepare data as a base64 encoded string) need to be
 *     implemented in the calling service."
 *     learn.microsoft.com/azure/azure-functions/functions-bindings-storage-queue-trigger
 *   - `QueueClient.sendMessage(messageText)` sends the text as-is, so
 *     "the calling service" above means exactly this function.
 *   - The `messageEncoding: "none"` opt-out is extension-bundle 5.0.0+,
 *     and both host.json files pin `[4.*, 5.0.0)`.
 */
function encode(message: NotificationMessage): string {
  return Buffer.from(JSON.stringify(message), "utf8").toString("base64");
}

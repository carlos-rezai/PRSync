import { generateLabel } from "../lib/label";
import { deriveNextRoundNumber } from "../lib/roundNumber";
import { snapshotReviewers } from "../lib/reviewerSnapshot";
import { isCloseReached } from "../lib/closePredicate";
import type {
  Author,
  IncomingReviewer,
  Phase,
  Round,
  RoundReviewer,
} from "../lib/types";
import {
  PreconditionFailedError,
  type RoundRepository,
} from "../storage/RoundRepository";
import type { NotificationPort } from "./NotificationPort";

// RoundService owns the lifecycle rules. It derives server-owned fields
// (round number, status, timestamps, quorum), enforces the open guards,
// and triggers the NotificationPort *after* commit — an isolated port
// failure never rolls back or fails a legitimate transition.

export type RoundServiceErrorCode =
  | "ROUND_ALREADY_OPEN"
  | "INSUFFICIENT_REVIEWERS"
  | "NOT_A_REVIEWER"
  | "ROUND_NOT_OPEN"
  | "CONCURRENCY_EXHAUSTED";

// A final toggle can lose the ETag race to a competing writer; re-read
// and retry a bounded number of times before surfacing 503.
const MAX_TOGGLE_ATTEMPTS = 3;

export class RoundServiceError extends Error {
  constructor(
    public readonly code: RoundServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RoundServiceError";
  }
}

export interface OpenRoundInput {
  phase: Phase;
  reviewers: IncomingReviewer[];
  prTitle: string;
  prUrl: string;
  author: Author;
  label?: string;
}

export interface RoundServiceDeps {
  repository: RoundRepository;
  notifications: NotificationPort;
  defaultQuorum: number;
}

export interface ToggleDoneInput {
  roundNumber: number;
  callerAdoId: string;
  done: boolean;
}

export class RoundService {
  private readonly repository: RoundRepository;
  private readonly notifications: NotificationPort;
  private readonly defaultQuorum: number;

  constructor(deps: RoundServiceDeps) {
    this.repository = deps.repository;
    this.notifications = deps.notifications;
    this.defaultQuorum = deps.defaultQuorum;
  }

  async openRound(prKey: string, input: OpenRoundInput): Promise<Round> {
    const current = await this.repository.getCurrentRound(prKey);
    if (current !== null && current.status === "open") {
      throw new RoundServiceError(
        "ROUND_ALREADY_OPEN",
        "A round is already open on this PR."
      );
    }

    const quorum = this.defaultQuorum;
    const reviewers = snapshotReviewers(input.reviewers, input.author.adoId);
    if (reviewers.length < quorum) {
      throw new RoundServiceError(
        "INSUFFICIENT_REVIEWERS",
        "Fewer tracked reviewers than the quorum; the round could never close."
      );
    }

    const roundNumber = deriveNextRoundNumber(
      current === null ? null : current.roundNumber
    );
    const round: Round = {
      prKey,
      roundNumber,
      phase: input.phase,
      label: input.label ?? generateLabel(roundNumber, input.phase),
      status: "open",
      quorum,
      reviewers,
      prTitle: input.prTitle,
      prUrl: input.prUrl,
      authorAdoId: input.author.adoId,
      authorName: input.author.name,
      authorEmail: input.author.email,
      openedAt: new Date().toISOString(),
      schemaVersion: 1,
    };

    const committed = await this.repository.createRound(round);
    await this.notifyRoundOpened(committed);
    return committed;
  }

  async getCurrentRound(prKey: string): Promise<Round | null> {
    return this.repository.getCurrentRound(prKey);
  }

  /**
   * Sets the caller's own Done state on an open round. The target is
   * always `callerAdoId` — no reviewer can toggle another. When the
   * toggle brings the round to quorum, the open->closed transition and
   * the `roundClosed` signal are bound to the single winning atomic
   * write, so under concurrent final toggles the safety signal fires
   * exactly once. ETag `If-Match` guards every write with a bounded
   * retry on precondition failure; a toggle on an already-closed round
   * is refused ROUND_NOT_OPEN without re-notifying.
   */
  async toggleDone(prKey: string, input: ToggleDoneInput): Promise<Round> {
    for (let attempt = 0; attempt < MAX_TOGGLE_ATTEMPTS; attempt++) {
      const stored = await this.repository.getRound(prKey, input.roundNumber);
      if (stored === null || stored.round.status !== "open") {
        // A missing round can never be toggled; treat it the same as a
        // closed one — the round is not in a live, toggleable state.
        if (
          stored !== null &&
          !stored.round.reviewers.some((r) => r.adoId === input.callerAdoId)
        ) {
          throw new RoundServiceError(
            "NOT_A_REVIEWER",
            "Caller is not a snapshotted reviewer on this round."
          );
        }
        throw new RoundServiceError(
          "ROUND_NOT_OPEN",
          "The round is not open; its Done state is frozen."
        );
      }

      const { round, etag } = stored;
      if (!round.reviewers.some((r) => r.adoId === input.callerAdoId)) {
        throw new RoundServiceError(
          "NOT_A_REVIEWER",
          "Caller is not a snapshotted reviewer on this round."
        );
      }

      const reviewers = round.reviewers.map((r) =>
        r.adoId === input.callerAdoId ? applyDone(r, input.done) : r
      );
      let next: Round = { ...round, reviewers };
      const willClose = isCloseReached(next);
      if (willClose) {
        next = {
          ...next,
          status: "closed",
          closedAt: new Date().toISOString(),
        };
      }

      try {
        const committed = await this.repository.updateRound(next, etag);
        if (willClose) await this.notifyRoundClosed(committed.round);
        return committed.round;
      } catch (error) {
        if (error instanceof PreconditionFailedError) {
          // Lost the race — re-read and retry within the bound.
          continue;
        }
        throw error;
      }
    }

    throw new RoundServiceError(
      "CONCURRENCY_EXHAUSTED",
      "Concurrent writes prevented the toggle from committing; retry."
    );
  }

  /**
   * Post-commit notification, isolated: a failing notifier must never
   * roll back or fail an already-committed open.
   */
  private async notifyRoundOpened(round: Round): Promise<void> {
    try {
      await this.notifications.roundOpened(round);
    } catch {
      // Isolated by design — the round is committed regardless. Feature 3
      // adds a real logger/outbox behind the port; nothing to do here.
    }
  }

  /**
   * Post-commit close notification, isolated: a failing notifier must
   * never roll back or fail an already-committed close.
   */
  private async notifyRoundClosed(round: Round): Promise<void> {
    try {
      await this.notifications.roundClosed(round);
    } catch {
      // Isolated by design — the close is committed regardless.
    }
  }
}

/**
 * Returns the reviewer with `done` set to the desired state. Setting
 * Done stamps `doneAt` (preserving an existing stamp so a repeat is
 * idempotent); clearing it drops the stamp.
 */
function applyDone(reviewer: RoundReviewer, done: boolean): RoundReviewer {
  if (done) {
    return {
      ...reviewer,
      done: true,
      doneAt: reviewer.doneAt ?? new Date().toISOString(),
    };
  }
  const { doneAt: _dropped, ...rest } = reviewer;
  return { ...rest, done: false };
}

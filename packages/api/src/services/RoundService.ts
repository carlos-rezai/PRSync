import { generateLabel } from "../lib/label";
import { deriveNextRoundNumber } from "../lib/roundNumber";
import { snapshotReviewers } from "../lib/reviewerSnapshot";
import type { Author, IncomingReviewer, Phase, Round } from "../lib/types";
import type { RoundRepository } from "../storage/RoundRepository";
import type { NotificationPort } from "./NotificationPort";

// RoundService owns the lifecycle rules. It derives server-owned fields
// (round number, status, timestamps, quorum), enforces the open guards,
// and triggers the NotificationPort *after* commit — an isolated port
// failure never rolls back or fails a legitimate transition.

export type RoundServiceErrorCode =
  "ROUND_ALREADY_OPEN" | "INSUFFICIENT_REVIEWERS";

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
}

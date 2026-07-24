import { odata, type TableClient, type TableEntity } from "@azure/data-tables";
import type { Phase, Round, RoundReviewer, RoundStatus } from "../../lib";

// The repository is the ONLY layer that touches @azure/data-tables.
// Access is by exact partition key with point reads/writes — user input
// never enters a hand-built OData filter (the `odata` tagged template
// escapes the PR key), so injection is impossible by construction.
//
// One entity per round: PartitionKey = PR key, RowKey = zero-padded
// round number so rows sort by round ascending. `reviewers` is stored
// as a JSON string and (de)serialized here.

export interface RoundRepository {
  getCurrentRound(prKey: string): Promise<Round | null>;
  createRound(round: Round): Promise<Round>;
  getRound(
    prKey: string,
    roundNumber: number
  ): Promise<{ round: Round; etag: string } | null>;
  updateRound(
    round: Round,
    etag: string
  ): Promise<{ round: Round; etag: string }>;
}

/**
 * Thrown when a conditional write is rejected because the entity's ETag
 * has moved on since it was read — the caller lost an optimistic-
 * concurrency race and should re-read and retry.
 */
export class PreconditionFailedError extends Error {
  constructor(message = "ETag precondition failed.") {
    super(message);
    this.name = "PreconditionFailedError";
  }
}

type RoundEntity = TableEntity<{
  roundNumber: number;
  phase: string;
  label: string;
  status: string;
  quorum: number;
  reviewers: string;
  prTitle: string;
  prUrl: string;
  authorAdoId: string;
  authorName: string;
  authorEmail: string;
  openedAt: string;
  closedAt?: string;
  cancelledAt?: string;
  schemaVersion: number;
}>;

const ROW_KEY_WIDTH = 4;

function toRowKey(roundNumber: number): string {
  return String(roundNumber).padStart(ROW_KEY_WIDTH, "0");
}

function toEntity(round: Round): RoundEntity {
  const entity: RoundEntity = {
    partitionKey: round.prKey,
    rowKey: toRowKey(round.roundNumber),
    roundNumber: round.roundNumber,
    phase: round.phase,
    label: round.label,
    status: round.status,
    quorum: round.quorum,
    reviewers: JSON.stringify(round.reviewers),
    prTitle: round.prTitle,
    prUrl: round.prUrl,
    authorAdoId: round.authorAdoId,
    authorName: round.authorName,
    authorEmail: round.authorEmail,
    openedAt: round.openedAt,
    schemaVersion: round.schemaVersion,
  };
  if (round.closedAt !== undefined) entity.closedAt = round.closedAt;
  if (round.cancelledAt !== undefined) entity.cancelledAt = round.cancelledAt;
  return entity;
}

function toRound(entity: RoundEntity): Round {
  const round: Round = {
    prKey: entity.partitionKey,
    roundNumber: entity.roundNumber,
    phase: entity.phase as Phase,
    label: entity.label,
    status: entity.status as RoundStatus,
    quorum: entity.quorum,
    reviewers: JSON.parse(entity.reviewers) as RoundReviewer[],
    prTitle: entity.prTitle,
    prUrl: entity.prUrl,
    authorAdoId: entity.authorAdoId,
    authorName: entity.authorName,
    authorEmail: entity.authorEmail,
    openedAt: entity.openedAt,
    schemaVersion: entity.schemaVersion,
  };
  if (entity.closedAt !== undefined) round.closedAt = entity.closedAt;
  if (entity.cancelledAt !== undefined) round.cancelledAt = entity.cancelledAt;
  return round;
}

export class TableStorageRoundRepository implements RoundRepository {
  constructor(private readonly client: TableClient) {}

  async getCurrentRound(prKey: string): Promise<Round | null> {
    const entities = this.client.listEntities<RoundEntity>({
      queryOptions: { filter: odata`PartitionKey eq ${prKey}` },
    });

    let latest: RoundEntity | null = null;
    for await (const entity of entities) {
      if (latest === null || entity.roundNumber > latest.roundNumber) {
        latest = entity;
      }
    }
    return latest === null ? null : toRound(latest);
  }

  async createRound(round: Round): Promise<Round> {
    await this.client.createEntity(toEntity(round));
    return round;
  }

  async getRound(
    prKey: string,
    roundNumber: number
  ): Promise<{ round: Round; etag: string } | null> {
    try {
      const entity = await this.client.getEntity<RoundEntity>(
        prKey,
        toRowKey(roundNumber)
      );
      return { round: toRound(entity), etag: entity.etag };
    } catch (error) {
      if (statusCodeOf(error) === 404) return null;
      throw error;
    }
  }

  async updateRound(
    round: Round,
    etag: string
  ): Promise<{ round: Round; etag: string }> {
    try {
      const response = await this.client.updateEntity(
        toEntity(round),
        "Replace",
        { etag }
      );
      if (response.etag === undefined) {
        throw new Error(
          "Table Storage returned no ETag on a successful update."
        );
      }
      return { round, etag: response.etag };
    } catch (error) {
      if (statusCodeOf(error) === 412) throw new PreconditionFailedError();
      throw error;
    }
  }
}

// The @azure/data-tables SDK surfaces HTTP faults as RestError-shaped
// objects carrying a numeric `statusCode`; read it structurally so the
// repository stays the only layer coupled to the SDK.
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

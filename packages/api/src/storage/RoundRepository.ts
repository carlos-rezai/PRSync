import { odata, type TableClient, type TableEntity } from "@azure/data-tables";
import type { Phase, Round, RoundReviewer, RoundStatus } from "../lib/types";

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
}

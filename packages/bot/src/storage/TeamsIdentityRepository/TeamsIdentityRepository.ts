import { TableClient, type TableEntity } from "@azure/data-tables";
import type { TeamsIdentity } from "../../lib";

// The repository is the ONLY layer that touches @azure/data-tables.
// Every access is a point read/write by exact partition + row key: the
// row key IS the normalized email, so there is no query to build and no
// value that arrived from Teams ever reaches a filter — injection is
// impossible by construction rather than by escaping.
//
// One entity per person, all in a single partition. PRSync's identities
// are a flat directory of a few dozen teammates with no natural grouping
// and no listing, so a constant partition keeps every operation a point
// operation and leaves the rows batchable if that is ever wanted.
//
// The repository stores what it is given: normalizing the address is
// IdentityDirectory's job, hidden behind its three verbs.

export interface TeamsIdentityRepository {
  upsert(identity: TeamsIdentity): Promise<void>;
  get(email: string): Promise<TeamsIdentity | null>;
  delete(email: string): Promise<void>;
}

/** Every identity lives in one partition — see the note above. */
const PARTITION_KEY = "identity";

const TABLE_NAME = "TeamsIdentities";

type TeamsIdentityEntity = TableEntity<{
  aadObjectId: string;
  teamsUserId: string;
  displayName: string;
  conversationReference: string;
  updatedAt: string;
}>;

function toEntity(identity: TeamsIdentity): TeamsIdentityEntity {
  return {
    partitionKey: PARTITION_KEY,
    rowKey: identity.email,
    aadObjectId: identity.aadObjectId,
    teamsUserId: identity.teamsUserId,
    displayName: identity.displayName,
    conversationReference: identity.conversationReference,
    updatedAt: identity.updatedAt,
  };
}

function toIdentity(entity: TeamsIdentityEntity): TeamsIdentity {
  return {
    // The address is the row key; storing it twice would let the two
    // spellings disagree.
    email: entity.rowKey,
    aadObjectId: entity.aadObjectId,
    teamsUserId: entity.teamsUserId,
    displayName: entity.displayName,
    conversationReference: entity.conversationReference,
    updatedAt: entity.updatedAt,
  };
}

export class TableStorageTeamsIdentityRepository implements TeamsIdentityRepository {
  constructor(private readonly client: TableClient) {}

  async upsert(identity: TeamsIdentity): Promise<void> {
    // Replace, not Merge: a re-capture is the whole row again, and a
    // merge would leave a field from a previous install behind.
    await this.client.upsertEntity(toEntity(identity), "Replace");
  }

  async get(email: string): Promise<TeamsIdentity | null> {
    try {
      const entity = await this.client.getEntity<TeamsIdentityEntity>(
        PARTITION_KEY,
        email
      );
      return toIdentity(entity);
    } catch (error) {
      // Unreachable is a fact, not a fault: the caller has to be able to
      // tell "no identity" from "storage broke".
      if (statusCodeOf(error) === 404) return null;
      throw error;
    }
  }

  async delete(email: string): Promise<void> {
    try {
      await this.client.deleteEntity(PARTITION_KEY, email);
    } catch (error) {
      // Teams can deliver an uninstall for a conversation PRSync never
      // captured — a redelivery, or an install that failed halfway.
      // Refusing it would poison a message over an outcome that is
      // already what was wanted.
      if (statusCodeOf(error) === 404) return;
      throw error;
    }
  }
}

/**
 * The repository over the `TeamsIdentities` table of the given account.
 * The composition root asks for this rather than a `TableClient`, so
 * `@azure/data-tables` stays inside this layer.
 */
export function createTeamsIdentityRepository(
  connectionString: string
): TeamsIdentityRepository {
  return new TableStorageTeamsIdentityRepository(
    TableClient.fromConnectionString(connectionString, TABLE_NAME)
  );
}

// The @azure/data-tables SDK surfaces HTTP faults as RestError-shaped
// objects carrying a numeric `statusCode`; read it structurally so the
// repository stays the only layer coupled to the SDK.
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code: unknown = error.statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

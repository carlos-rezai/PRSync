import {
  normalizeEmail,
  type CapturedIdentity,
  type ConversationRef,
  type ResolvedIdentity,
} from "../../lib";
import type { TeamsIdentityRepository } from "../../storage";

// The deep module of the install slice: three verbs behind which email
// normalization, conversation-reference serialization and the repository
// disappear entirely. Nothing above this layer ever sees a row key or a
// serialized reference.
//
// `capture` is an upsert, which is what makes it the refresh too: the
// install writes the first row and every later activity writes over it,
// so a reference that has gone stale is replaced rather than kept beside
// the current one.

export interface IdentityDirectory {
  /** Persist (or re-persist) how to reach a person. */
  capture(identity: CapturedIdentity): Promise<void>;
  /** How to reach a person, or null if they never installed the app. */
  resolve(email: string): Promise<ResolvedIdentity | null>;
  /** Drop a person's identity. Forgetting a stranger is not an error. */
  forget(email: string): Promise<void>;
}

export function createIdentityDirectory(
  repository: TeamsIdentityRepository
): IdentityDirectory {
  return {
    async capture(identity: CapturedIdentity): Promise<void> {
      await repository.upsert({
        email: normalizeEmail(identity.email),
        aadObjectId: identity.aadObjectId,
        teamsUserId: identity.teamsUserId,
        displayName: identity.displayName,
        conversationReference: JSON.stringify(identity.conversationReference),
        updatedAt: new Date().toISOString(),
      });
    },

    async resolve(email: string): Promise<ResolvedIdentity | null> {
      const stored = await repository.get(normalizeEmail(email));
      if (stored === null) return null;

      return {
        email: stored.email,
        aadObjectId: stored.aadObjectId,
        teamsUserId: stored.teamsUserId,
        displayName: stored.displayName,
        conversationReference: JSON.parse(
          stored.conversationReference
        ) as ConversationRef,
        updatedAt: stored.updatedAt,
      };
    },

    forget(email: string): Promise<void> {
      return repository.delete(normalizeEmail(email));
    },
  };
}

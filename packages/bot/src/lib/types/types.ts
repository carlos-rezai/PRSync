// The shared types of the bot package. The LEAF layer: no other layer,
// and in particular not `botbuilder`, is imported from here — a
// conversation reference is described structurally so that `services/`
// and `storage/` can pass one around without Bot Framework anywhere in
// their tests.

/** A participant on a conversation reference: the person, or the bot. */
export interface ConversationRefParticipant {
  id?: string;
  name?: string;
  aadObjectId?: string;
  role?: string;
}

/** The conversation itself — for PRSync, always a 1:1 personal chat. */
export interface ConversationRefConversation extends ConversationRefParticipant {
  conversationType?: string;
  isGroup?: boolean;
  tenantId?: string;
}

/**
 * The handle the bot opens a 1:1 DM with, mirroring Bot Framework's own
 * `ConversationReference` field for field so that one is assignable to
 * this without a cast. Every field is optional because the SDK hands
 * back a `Partial<ConversationReference>`; PRSync treats the whole thing
 * as opaque and never reads into it outside `teams/`.
 */
export interface ConversationRef {
  activityId?: string;
  channelId?: string;
  serviceUrl?: string;
  locale?: string;
  user?: ConversationRefParticipant;
  bot?: ConversationRefParticipant;
  conversation?: ConversationRefConversation;
}

/**
 * What an inbound activity yields about the person who sent it, before
 * `IdentityDirectory` normalizes the address and serializes the
 * reference. The email arrives as Teams spells it.
 */
export interface CapturedIdentity {
  email: string;
  /** The person's AAD object id — stored, unused as a key in v1. */
  aadObjectId: string;
  teamsUserId: string;
  displayName: string;
  conversationReference: ConversationRef;
}

/**
 * A `TeamsIdentities` row. `email` is normalized (it IS the row key) and
 * the conversation reference is serialized, which is the form Table
 * Storage can hold and the reason nothing above `services/` sees it.
 */
export interface TeamsIdentity {
  email: string;
  aadObjectId: string;
  teamsUserId: string;
  displayName: string;
  /** The JSON-serialized `ConversationRef`. */
  conversationReference: string;
  /** ISO timestamp of the capture that wrote this row. */
  updatedAt: string;
}

/**
 * A stored identity as callers above `services/` see it: the reference
 * back as the object it went in as, never the serialization.
 */
export interface ResolvedIdentity extends CapturedIdentity {
  updatedAt: string;
}

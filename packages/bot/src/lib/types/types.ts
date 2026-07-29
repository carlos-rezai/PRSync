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

/**
 * What a notification carries for a card to render — a self-contained
 * snapshot of the round at the moment it opened or closed, never a
 * reference back to one. A DM is read minutes or hours later, and it
 * must say what was true when it was sent.
 */
export interface CardContent {
  roundLabel: string;
  prTitle: string;
  prUrl: string;
  authorName: string;
}

/** What happened on a round, and therefore which card it calls for. */
export type NotificationEvent = "roundOpened" | "roundClosed";

/** The one person a notification message is addressed to. */
export interface NotificationRecipient {
  /** The ADO identity id — the recipient half of the dedupe key. */
  adoId: string;
  /** As ADO spells it; `IdentityDirectory` owns normalizing it. */
  email: string;
  displayName: string;
}

/**
 * One queued unit of delivery: exactly one DM to exactly one person,
 * carrying everything the card needs. Never one message per round — a
 * person nobody can reach must not be able to block the rest.
 *
 * Self-contained and denormalized on purpose: the bot holds no Rounds
 * table, so a round that closes between enqueue and send cannot make a
 * round-opened card render post-close state.
 *
 * Declared structurally narrower here, on the consumer side, than the
 * producer's own type. The two packages agree by `schemaVersion`, not by
 * a shared compiler — nothing links `packages/api` to `packages/bot`,
 * and a message is read minutes after it was written by a build that may
 * no longer be deployed.
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

// The Adaptive Card subset PRSync builds, typed rather than pulled in
// from `adaptivecards`: v1 emits two static cards out of a headline, a
// fact set and one link-out button, and a narrow type is what makes the
// frozen handoff design checkable against the builders.

/** One row of a `FactSet`: a label and the value beside it. */
export interface CardFact {
  title: string;
  value: string;
}

/** The label/value block under a card's headline. */
export interface CardFactSet {
  type: "FactSet";
  facts: CardFact[];
}

/** A line of text. Renders limited markdown — hence `escapeCardText`. */
export interface CardTextBlock {
  type: "TextBlock";
  text: string;
  weight?: "Lighter" | "Default" | "Bolder";
  size?: "Small" | "Default" | "Medium" | "Large" | "ExtraLarge";
  /** Long values wrap instead of being clipped at the card's width. */
  wrap?: boolean;
  color?:
    "Default" | "Dark" | "Light" | "Accent" | "Good" | "Warning" | "Attention";
}

/** Everything a PRSync card puts in its `body`. */
export type CardElement = CardTextBlock | CardFactSet;

/**
 * A button. `Action.OpenUrl` is the only kind v1 emits — the cards are
 * link-out only, and interactive actions are deferred to v2.
 */
export interface CardAction {
  type: "Action.OpenUrl";
  title: string;
  url: string;
}

/**
 * A whole card, as the bot hands it to Teams.
 *
 * `actions` is optional because an unsafe `prUrl` produces a card with
 * no button at all rather than a hostile one — see `safeCardUrl`.
 */
export interface AdaptiveCard {
  type: "AdaptiveCard";
  $schema: string;
  version: string;
  body: CardElement[];
  actions?: CardAction[];
}

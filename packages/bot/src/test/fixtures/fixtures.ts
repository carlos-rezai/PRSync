// Domain data every layer's tests key off, mirroring
// `packages/api/src/test/fixtures/fixtures.ts`. Fakes live next door in
// `fakes.ts`; this file holds only real values and the activity builders
// that stand in for what Teams actually posts.
//
// Like the api's, these sit outside the layer conventions deliberately:
// storage/, services/, teams/ and functions/ tests all consume them, so
// putting them inside any one layer would force imports upward and
// across layers.

import type { Activity, TeamsChannelAccount } from "botbuilder";
import type {
  CapturedIdentity,
  CardContent,
  ConversationRef,
  TeamsIdentity,
} from "../../lib";

/**
 * The bot's own Teams account. An install is a `conversationUpdate` whose
 * `membersAdded` contains THE BOT — not the person — so every activity
 * fixture has to address the bot by the same id its `recipient` carries,
 * or the routing under test cannot tell an install from a stranger
 * joining.
 */
export const BOT_ID = "28:6f5e4d3c-2b1a-0908-1716-2524232221f0";
export const BOT_NAME = "PRSync";

/** The teammate who sideloads PRSync. */
export const PERSON = {
  teamsUserId: "29:1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  aadObjectId: "aabbccdd-eeff-0011-2233-445566778899",
  displayName: "Dana Reviewer",
  /** Normalized: lowercased and trimmed. This is the row key. */
  email: "dana.reviewer@contoso.com",
} as const;

/**
 * The same address as it arrives in the wild. ADO's `uniqueName`, Teams'
 * `userPrincipalName` and a hand-typed override all mean one person, and
 * they disagree about case and padding — which is the whole reason
 * normalization exists.
 */
export const PERSON_EMAIL_VARIANTS = [
  "Dana.Reviewer@Contoso.com",
  "DANA.REVIEWER@CONTOSO.COM",
  "  dana.reviewer@contoso.com  ",
  "\tDana.Reviewer@Contoso.com\n",
] as const;

/** Someone who never installed the app. */
export const STRANGER_EMAIL = "morgan.bystander@contoso.com";

export const SERVICE_URL = "https://smba.trafficmanager.net/emea/";

/** The 1:1 chat Teams opens at install. */
export const CONVERSATION_ID = "a:1personal-chat-with-dana";

/**
 * A DIFFERENT chat id for the same person. References go stale — Teams
 * can hand the bot a new one on a later activity — which is exactly what
 * the refresh-on-any-activity rule exists to survive.
 */
export const REFRESHED_CONVERSATION_ID = "a:2personal-chat-with-dana-moved";

/** A conversation reference as it crosses PRSync's own layers: opaque. */
export function makeConversationRef(
  conversationId: string = CONVERSATION_ID
): ConversationRef {
  return {
    channelId: "msteams",
    serviceUrl: SERVICE_URL,
    conversation: { id: conversationId, conversationType: "personal" },
    bot: { id: BOT_ID, name: BOT_NAME },
    user: { id: PERSON.teamsUserId, name: PERSON.displayName },
  };
}

/** What `IdentityDirectory.capture` is handed. */
export function makeCapturedIdentity(
  overrides: Partial<CapturedIdentity> = {}
): CapturedIdentity {
  return {
    email: PERSON.email,
    aadObjectId: PERSON.aadObjectId,
    teamsUserId: PERSON.teamsUserId,
    displayName: PERSON.displayName,
    conversationReference: makeConversationRef(),
    ...overrides,
  };
}

/** A row as the repository stores and returns it. */
export function makeTeamsIdentity(
  overrides: Partial<TeamsIdentity> = {}
): TeamsIdentity {
  return {
    email: PERSON.email,
    aadObjectId: PERSON.aadObjectId,
    teamsUserId: PERSON.teamsUserId,
    displayName: PERSON.displayName,
    conversationReference: JSON.stringify(makeConversationRef()),
    updatedAt: "2026-07-27T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * The member profile the Teams connector answers with. Teams does not put
 * an email on the activity, so the bot has to ask — this is what it gets
 * back.
 *
 * Typed as the SDK's own account plus whatever else the connector sends
 * (`objectId`, `tenantId`): the profile is what a mocked `getMember`
 * resolves with, so it has to BE that type rather than be asserted into
 * it at the call site.
 */
export function makeTeamsMember(
  overrides: Record<string, unknown> = {}
): TeamsChannelAccount & Record<string, unknown> {
  return {
    id: PERSON.teamsUserId,
    name: PERSON.displayName,
    email: PERSON.email,
    userPrincipalName: PERSON.email,
    aadObjectId: PERSON.aadObjectId,
    objectId: PERSON.aadObjectId,
    tenantId: "11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

/**
 * What a notification message carries for the card to render — the
 * self-contained snapshot, never a reference back to a round.
 *
 * Deliberately free of markdown control characters: this is the value
 * the frozen-handoff equality tests substitute into the template, so
 * escaping has to be a no-op for it or those tests would be asserting
 * the escaper rather than the card. The em dash is not ASCII
 * punctuation and must survive untouched — it is in every round label
 * this product generates.
 */
export const CARD_CONTENT: CardContent = {
  roundLabel: "Round 2 — Implementation Review",
  prTitle: "Add reviewer done-toggle endpoint",
  prUrl: "https://dev.azure.com/contoso/PRSync/_git/PRSync/pullrequest/42",
  authorName: "Sam Author",
};

/**
 * A PR title, round label or display name crafted to inject a link into
 * a DM sent under PRSync's own name. Every markdown device a `TextBlock`
 * might honour is in here at once.
 */
export const HOSTILE_CARD_TEXT =
  "[Click here](https://evil.example) *urgent* _now_ `code` ~strike~ #1 - !img";

/** The same content, with every text-bearing field hostile. */
export const HOSTILE_CARD_CONTENT: CardContent = {
  roundLabel: HOSTILE_CARD_TEXT,
  prTitle: HOSTILE_CARD_TEXT,
  prUrl: CARD_CONTENT.prUrl,
  authorName: HOSTILE_CARD_TEXT,
};

/**
 * Long enough to push the action button off a phone-sized card. Letters
 * and spaces only, so truncation can be asserted by length without the
 * escaper changing it.
 */
export const LONG_CARD_TEXT =
  "Refactor the round lifecycle service so the quorum rule is one place ".repeat(
    20
  );

/** The same content, with every text-bearing field far too long. */
export const LONG_CARD_CONTENT: CardContent = {
  roundLabel: LONG_CARD_TEXT,
  prTitle: LONG_CARD_TEXT,
  prUrl: CARD_CONTENT.prUrl,
  authorName: LONG_CARD_TEXT,
};

/**
 * URLs that must never reach an `Action.OpenUrl`. `prUrl` arrives from
 * the round-open request body, so it is attacker-controlled — and a
 * button in a message from PRSync is exactly what someone would click.
 */
export const UNSAFE_CARD_URLS = [
  "javascript:alert(document.cookie)",
  "JavaScript:alert(1)",
  "  javascript:alert(1)  ",
  "java\nscript:alert(1)",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)",
  "file:///c:/windows/system32",
  "http://dev.azure.com/contoso/PRSync/_git/PRSync/pullrequest/42",
  "//evil.example/pullrequest/42",
  "/contoso/PRSync/pullrequest/42",
  "dev.azure.com/contoso/PRSync/pullrequest/42",
  "not a url at all",
  "   ",
  "",
] as const;

/** The fields every inbound activity carries, whatever its type. */
function activityEnvelope(
  conversationId: string
): Partial<Activity> & { conversation: { id: string } } {
  return {
    channelId: "msteams",
    serviceUrl: SERVICE_URL,
    from: {
      id: PERSON.teamsUserId,
      name: PERSON.displayName,
      aadObjectId: PERSON.aadObjectId,
    },
    recipient: { id: BOT_ID, name: BOT_NAME },
    conversation: { id: conversationId, conversationType: "personal" },
  } as Partial<Activity> & { conversation: { id: string } };
}

/**
 * The install: a `conversationUpdate` with THE BOT in `membersAdded`.
 * Nobody registers anywhere — adding the app *is* the registration, so
 * this activity is the only thing that happens.
 */
export function installActivity(
  conversationId: string = CONVERSATION_ID
): Partial<Activity> {
  return {
    ...activityEnvelope(conversationId),
    type: "conversationUpdate",
    membersAdded: [{ id: BOT_ID, name: BOT_NAME }],
  };
}

/** The uninstall: the same event with THE BOT in `membersRemoved`. */
export function uninstallActivity(
  conversationId: string = CONVERSATION_ID
): Partial<Activity> {
  return {
    ...activityEnvelope(conversationId),
    type: "conversationUpdate",
    membersRemoved: [{ id: BOT_ID, name: BOT_NAME }],
  };
}

/**
 * A `conversationUpdate` where somebody OTHER than the bot was added.
 * PRSync is personal-scope only, but the event shape is shared, and
 * treating this as an install would capture an identity for a person who
 * never installed anything.
 */
export function otherMemberAddedActivity(
  conversationId: string = CONVERSATION_ID
): Partial<Activity> {
  return {
    ...activityEnvelope(conversationId),
    type: "conversationUpdate",
    membersAdded: [{ id: "29:someone-else-entirely", name: "Someone Else" }],
  };
}

/** A person typing at the bot — the only way to confirm an install worked. */
export function messageActivity(
  text = "hello?",
  conversationId: string = CONVERSATION_ID
): Partial<Activity> {
  return {
    ...activityEnvelope(conversationId),
    type: "message",
    text,
  };
}

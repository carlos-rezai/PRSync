import {
  ActivityHandler,
  TeamsInfo,
  TurnContext,
  type ChannelAccount,
} from "botbuilder";
import type { CapturedIdentity } from "../../lib";
import type { IdentityDirectory } from "../../services";

// The bot's activity routing: which Teams event means what, and what the
// directory is told about it. This is the only module in the package that
// reads a Teams activity, and the only one that asks the connector who
// the person behind a turn is.

/**
 * The reply to anything a teammate types. v1 cards are link-out only and
 * arrive unprompted, so this is the ONLY way someone can confirm that
 * adding the app did anything — which is why the bot is deliberately not
 * registered notification-only.
 */
const HELP_REPLY =
  "PRSync is connected. You'll get a message here when a review round " +
  "opens on a pull request you're reviewing, and when a round on your own " +
  "pull request closes. There's nothing else to set up — leave PRSync " +
  "installed and it will find you.";

/** Whether `members` names the bot itself rather than some other person. */
function includesBot(
  members: ChannelAccount[] | undefined,
  botId: string
): boolean {
  return (members ?? []).some((member) => member.id === botId);
}

/**
 * Everything about the person behind this turn. Teams puts no email on
 * an activity, so the bot has to ask the connector for the member's
 * profile — the one call in this slice that leaves the process.
 */
async function readIdentity(
  context: TurnContext
): Promise<CapturedIdentity | null> {
  const activity = context.activity;
  const member = await TeamsInfo.getMember(context, activity.from.id);

  // `email` is what the Teams connector answers with; `userPrincipalName`
  // is the same address under the name AAD gives it, and the one ADO's
  // `uniqueName` matches. Either resolves to the same normalized key.
  const email = member.email ?? member.userPrincipalName ?? "";
  if (email.trim() === "") return null;

  return {
    email,
    aadObjectId: member.aadObjectId ?? activity.from.aadObjectId ?? "",
    teamsUserId: member.id,
    displayName: member.name,
    conversationReference: TurnContext.getConversationReference(activity),
  };
}

/**
 * The bot: install captures, uninstall forgets, and any message both
 * refreshes the reference and answers.
 *
 * An install is a `conversationUpdate` carrying THE BOT in
 * `membersAdded` — not the person — and an uninstall is the same event
 * with the bot in `membersRemoved`. `conversationUpdate` is a shared
 * event shape, so treating any `membersAdded` as an install would
 * capture an identity for somebody who installed nothing.
 */
export function createTeamsBot(directory: IdentityDirectory): ActivityHandler {
  const bot = new ActivityHandler();

  bot.onConversationUpdate(async (context, next) => {
    const activity = context.activity;
    const botId = activity.recipient.id;

    if (includesBot(activity.membersAdded, botId)) {
      const identity = await readIdentity(context);
      if (identity !== null) await directory.capture(identity);
    } else if (includesBot(activity.membersRemoved, botId)) {
      const identity = await readIdentity(context);
      // A reference kept past the uninstall is dead: it burns the full
      // retry budget into the poison queue on every future round, and it
      // is PII PRSync no longer has any reason to hold.
      if (identity !== null) await directory.forget(identity.email);
    }

    await next();
  });

  bot.onMessage(async (context, next) => {
    // References go stale, and Teams can hand the bot a new one on any
    // later activity. Re-persisting here is cheap insurance against
    // notifications that stop arriving with nothing reporting a fault.
    const identity = await readIdentity(context);
    if (identity !== null) await directory.capture(identity);

    await context.sendActivity(HELP_REPLY);
    await next();
  });

  return bot;
}

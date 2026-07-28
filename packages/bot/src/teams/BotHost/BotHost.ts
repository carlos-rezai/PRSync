import {
  ActivityHandler,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  TeamsInfo,
  TurnContext,
  type ChannelAccount,
  type Request as BotFrameworkRequest,
  type Response as BotFrameworkResponse,
} from "botbuilder";
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import type { CapturedIdentity } from "../../lib";
import type { IdentityDirectory } from "../../services";

// `teams/` is the exact analogue of the extension's `sdk/` layer: the one
// place that imports the vendor SDK. Everything below it — the
// directory, the repository, the helpers — is testable with no Bot
// Framework in the test at all, and stays that way only as long as this
// stays the sole importer.
//
// Three things live here: the bot's activity routing, the settings the
// adapter authenticates with, and the adapter itself behind a
// `MessagingEndpoint` narrow enough that the HTTP function knows nothing
// about Bot Framework.

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

/**
 * The settings the adapter authenticates every inbound request with.
 * `/api/messages` is anonymous of necessity — Azure Bot Service cannot
 * present a Function key — so these four values ARE the authentication.
 */
export interface BotConfig {
  readonly appId: string;
  readonly appPassword: string;
  readonly tenantId: string;
  readonly appType: "SingleTenant";
}

const SETTINGS = {
  appId: "MICROSOFT_APP_ID",
  appPassword: "MICROSOFT_APP_PASSWORD",
  tenantId: "MICROSOFT_APP_TENANT_ID",
  appType: "MICROSOFT_APP_TYPE",
} as const;

/**
 * Reads the bot's settings, refusing to start without them. A missing
 * password or a tenant that silently defaults does not fail loudly on
 * its own; it produces a bot that accepts tokens it should not, or
 * accepts none at all, and either way the only symptom is DMs that never
 * arrive.
 */
export function readBotConfig(
  env: Record<string, string | undefined>
): BotConfig {
  const required = (key: string): string => {
    const value = env[key]?.trim() ?? "";
    if (value === "") {
      // Named, because the operator reading this line is looking at four
      // near-identical settings in a configuration blade.
      throw new Error(
        `${key} is not set. The bot cannot authenticate without it.`
      );
    }
    return value;
  };

  const appType = required(SETTINGS.appType);
  if (appType !== "SingleTenant") {
    // PRSync is sideloaded inside one org's tenant and will never be
    // listed in the Teams Store. MultiTenant widens the token audience to
    // every directory in the Bot Framework channel — a setting nobody
    // would notice was wrong, because the bot keeps working.
    throw new Error(
      `${SETTINGS.appType} is "${appType}", but PRSync must be registered SingleTenant.`
    );
  }

  return {
    appId: required(SETTINGS.appId),
    appPassword: required(SETTINGS.appPassword),
    tenantId: required(SETTINGS.tenantId),
    appType,
  };
}

/**
 * The Bot Framework adapter, as the HTTP function sees it: hand it the
 * request, hand back what it answers. Everything the channel needs —
 * JWT validation against app id, password and tenant, the 401 when that
 * fails, the status an activity produces — happens inside.
 */
export interface MessagingEndpoint {
  process(request: HttpRequest): Promise<HttpResponseInit>;
}

/** The Azure Functions request, in the shape the adapter reads. */
async function toBotFrameworkRequest(
  request: HttpRequest
): Promise<BotFrameworkRequest> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });

  return {
    method: request.method,
    headers,
    body: (await request.json()) as Record<string, unknown>,
  };
}

/**
 * The response the adapter writes to. It answers the channel itself — an
 * activity can produce a 401, a 202 or an invoke response body — so this
 * only records what it said, and the function returns that unaltered
 * rather than inventing a status on top of it.
 */
class CollectedResponse implements BotFrameworkResponse {
  readonly socket: unknown = undefined;
  private statusCode = 200;
  private body: unknown = undefined;
  private readonly headers: Record<string, string> = {};

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(name: string, value: unknown): this {
    this.headers[name] = String(value);
    return this;
  }

  send(...args: unknown[]): this {
    this.body = args[0];
    return this;
  }

  end(..._args: unknown[]): this {
    return this;
  }

  toHttpResponse(): HttpResponseInit {
    const response: HttpResponseInit = {
      status: this.statusCode,
      headers: this.headers,
    };
    if (this.body !== undefined) response.jsonBody = this.body;
    return response;
  }
}

/** The adapter, wired to the bot and to the settings it authenticates with. */
export function createMessagingEndpoint(
  config: BotConfig,
  bot: ActivityHandler
): MessagingEndpoint {
  const adapter = new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication(
      {
        MicrosoftAppId: config.appId,
        MicrosoftAppTenantId: config.tenantId,
      },
      new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: config.appId,
        MicrosoftAppPassword: config.appPassword,
        MicrosoftAppType: config.appType,
        MicrosoftAppTenantId: config.tenantId,
      })
    )
  );

  return {
    async process(request: HttpRequest): Promise<HttpResponseInit> {
      const response = new CollectedResponse();
      await adapter.process(
        await toBotFrameworkRequest(request),
        response,
        (context) => bot.run(context)
      );
      return response.toHttpResponse();
    },
  };
}

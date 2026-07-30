import {
  ActivityHandler,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  type Request as BotFrameworkRequest,
  type Response as BotFrameworkResponse,
} from "botbuilder";
import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import type { BotConfig } from "../BotConfig/BotConfig";

// `teams/` is the exact analogue of the extension's `sdk/` layer: the one
// place that imports the vendor SDK. Everything below it — the
// directory, the repository, the helpers — is testable with no Bot
// Framework in the test at all, and stays that way only as long as this
// layer stays the sole importer.
//
// Two things live here: the adapter itself, and the `MessagingEndpoint`
// wrapping it narrowly enough that the HTTP function knows nothing about
// Bot Framework. The settings it authenticates with are its sibling
// `BotConfig`; the activity routing it runs a turn against is
// `TeamsBot`.

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

/**
 * The adapter, authenticated with the bot's settings.
 *
 * Built once and shared: it is both the inbound path (validating the
 * channel's JWT on every activity) and the outbound one (opening a
 * proactive 1:1 conversation to send a card), and a second instance
 * would be a second connector-client cache authenticating as the same
 * bot.
 */
export function createBotAdapter(config: BotConfig): CloudAdapter {
  return new CloudAdapter(
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
}

/** The inbound half of the adapter, wired to the bot that routes activities. */
export function createMessagingEndpoint(
  adapter: CloudAdapter,
  bot: ActivityHandler
): MessagingEndpoint {
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

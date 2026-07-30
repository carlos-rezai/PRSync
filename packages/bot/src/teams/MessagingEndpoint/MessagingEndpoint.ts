import type {
  TurnContext,
  Request as BotFrameworkRequest,
  Response as BotFrameworkResponse,
} from "botbuilder";
import type { HttpRequest, HttpResponseInit } from "@azure/functions";

// The translation between the two HTTP shapes that meet at
// `/api/messages`: the one Azure Functions hands a handler, and the one
// Bot Framework's adapter expects. Neither vendor knows about the other,
// so this module is the whole of the conversion — and the reason
// `teamsMessages` can be a three-line handler that names no Bot Framework
// type at all.

/**
 * The adapter's inbound half, as this module needs it. Structural on
 * purpose: `CloudAdapter` satisfies it without knowing it exists, which
 * is what lets the translation below be driven with no Bot Framework
 * standing up — the same trick `QueueProducer` plays on the Azure queue
 * client in `packages/api`.
 */
export interface ChannelRequestProcessor {
  process(
    request: BotFrameworkRequest,
    response: BotFrameworkResponse,
    logic: (context: TurnContext) => Promise<void>
  ): Promise<void>;
}

/**
 * The bot's turn routing, as this module needs it. One method, for the
 * same reason as above: `ActivityHandler` satisfies it structurally.
 */
export interface ActivityRunner {
  run(context: TurnContext): Promise<void>;
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

/** The inbound half of the adapter, wired to the bot that routes activities. */
export function createMessagingEndpoint(
  adapter: ChannelRequestProcessor,
  bot: ActivityRunner
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

import type {
  HttpFunctionOptions,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import type { MessagingEndpoint } from "../../teams";

// Thin HTTP entry point for POST /api/messages, the one endpoint every
// inbound Teams activity arrives at. It parses nothing and decides
// nothing: every rule about what an activity means lives behind the
// messaging endpoint, and every rule about whether the caller is really
// Bot Framework lives inside the adapter's JWT validation.

/**
 * Anonymous of necessity: Azure Bot Service cannot present a Function
 * key, so a function-key-protected endpoint simply never receives an
 * activity. It is not an open endpoint — the adapter validates the Bot
 * Framework JWT against app id, password and tenant on every request
 * (see `readBotConfig`) — but the two facts have to be read together,
 * which is why this is pinned here rather than left to a deployment
 * setting nobody diffs.
 */
export const teamsMessagesOptions: Omit<HttpFunctionOptions, "handler"> = {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "messages",
};

export function makeTeamsMessagesHandler(endpoint: MessagingEndpoint) {
  return function teamsMessages(
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> {
    // The adapter answers the channel itself, so its response is
    // returned unaltered.
    return endpoint.process(request);
  };
}

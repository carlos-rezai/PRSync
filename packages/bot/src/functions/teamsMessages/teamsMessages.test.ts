import { describe, it, expect } from "vitest";
import {
  makeTeamsMessagesHandler,
  teamsMessagesOptions,
} from "./teamsMessages";
import {
  makeContext,
  makeMessagingEndpoint,
  makeRequest,
} from "../../test/fixtures/fakes";

// The `functions/` layer is thin: parse nothing, decide nothing, hand the
// request to the adapter and hand its answer back. Every rule about what
// an activity means lives behind the messaging endpoint, and every rule
// about whether the caller is really Bot Framework lives inside the
// adapter's JWT validation.

describe("teamsMessages", () => {
  it("hands the request to the Bot Framework adapter and returns its response", async () => {
    // The adapter answers the channel itself — an activity can produce a
    // 401, a 202 or an invoke response body — so the handler must not
    // invent a status of its own on top of it.
    const endpoint = makeMessagingEndpoint({ status: 202 });
    const request = makeRequest();

    const response = await makeTeamsMessagesHandler(endpoint)(
      request,
      makeContext()
    );

    expect(endpoint.process).toHaveBeenCalledWith(request);
    expect(response).toEqual({ status: 202 });
  });

  it("is registered for POST at anonymous auth level", () => {
    // Anonymous of necessity: Azure Bot Service cannot present a Function
    // key, so a function-key-protected endpoint simply never receives an
    // activity. It is not an open endpoint — the adapter validates the Bot
    // Framework JWT against app id, password and tenant on every request
    // (see BotHost.config.test.ts) — but the two facts have to be read
    // together, which is why this one is pinned rather than left to a
    // deployment setting nobody diffs.
    expect(teamsMessagesOptions).toMatchObject({
      methods: ["POST"],
      authLevel: "anonymous",
      route: "messages",
    });
  });
});

import { describe, it, expect } from "vitest";
import { createMessagingEndpoint } from "./MessagingEndpoint";
import {
  makeActivityRunner,
  makeChannelRequestProcessor,
  makeRequest,
} from "../../test/fixtures/fakes";

// This module is the whole of the translation between the two HTTP shapes
// that meet at `/api/messages`: the one Azure Functions hands a handler,
// and the one Bot Framework's adapter expects. Nothing else in the package
// converts between them.
//
// It matters more than its size suggests. `/api/messages` is
// anonymous-auth of necessity — Azure Bot Service cannot present a
// Function key — so what keeps it from being an open endpoint is entirely
// the adapter validating the Bot Framework JWT. The adapter reads that
// token off the headers THIS module copies. A header dropped here is an
// endpoint that rejects every real activity, or worse, and no behavioural
// test elsewhere would notice.
//
// The adapter's own JWT validation is not tested here — that is Bot
// Framework's, and a test would only re-implement a vendor, the same
// stance `BotConfig.test.ts` takes. What is tested is the one part PRSync
// owns: that everything the adapter needs reaches it, and that whatever it
// answers comes back unaltered.
//
// Driven through a recording fake of the narrowed `ChannelRequestProcessor`
// port, so there is no Bot Framework in this file at all.

describe("the messaging endpoint — what reaches the adapter", () => {
  it("hands over every inbound header, so the token it authenticates with survives", async () => {
    const adapter = makeChannelRequestProcessor();
    const endpoint = createMessagingEndpoint(adapter, makeActivityRunner());

    await endpoint.process(
      makeRequest({
        headers: {
          authorization: "Bearer bot-framework-token",
          "content-type": "application/json",
        },
      })
    );

    // The adapter validates the JWT off these headers. Losing
    // `authorization` in the copy produces an endpoint that 401s every
    // genuine activity from the channel.
    expect(adapter.processed[0]?.request.headers).toMatchObject({
      authorization: "Bearer bot-framework-token",
      "content-type": "application/json",
    });
  });

  it("hands over the parsed body and the method", async () => {
    const adapter = makeChannelRequestProcessor();
    const endpoint = createMessagingEndpoint(adapter, makeActivityRunner());
    const activity = { type: "message", text: "did that work?" };

    await endpoint.process(makeRequest({ method: "POST", body: activity }));

    // Parsed, not raw: the adapter reads `body` as an object. Handing it
    // the unparsed stream is an activity the bot never sees.
    expect(adapter.processed[0]?.request).toMatchObject({
      method: "POST",
      body: activity,
    });
  });

  it("runs the bot for the turn", async () => {
    const adapter = makeChannelRequestProcessor();
    const bot = makeActivityRunner();

    await createMessagingEndpoint(adapter, bot).process(makeRequest());

    // An activity that authenticates but is never routed produces a
    // healthy-looking response and no install capture — the failure this
    // whole package exists downstream of.
    expect(bot.turns).toHaveLength(1);
  });
});

describe("the messaging endpoint — what comes back", () => {
  it("returns the status the adapter chose, rather than inventing one", async () => {
    // The adapter answers the channel itself: an activity can produce a
    // 401 from a token it rejected, or a 202 it accepted. Replacing that
    // with a default 200 tells Azure Bot Service every activity succeeded.
    const adapter = makeChannelRequestProcessor((response) => {
      response.status(401);
    });

    const response = await createMessagingEndpoint(
      adapter,
      makeActivityRunner()
    ).process(makeRequest());

    expect(response.status).toBe(401);
  });

  it("keeps the headers the adapter set", async () => {
    const adapter = makeChannelRequestProcessor((response) => {
      response.status(200);
      response.header("content-type", "application/json");
    });

    const response = await createMessagingEndpoint(
      adapter,
      makeActivityRunner()
    ).process(makeRequest());

    expect(response.headers).toMatchObject({
      "content-type": "application/json",
    });
  });

  it("returns a body the adapter sent as a JSON body", async () => {
    // An invoke activity — the shape v2's interactive card actions will
    // arrive as — is answered with a body, and the channel reads it.
    const invokeResponse = { status: 200, body: { ok: true } };
    const adapter = makeChannelRequestProcessor((response) => {
      response.status(200);
      response.send(invokeResponse);
    });

    const response = await createMessagingEndpoint(
      adapter,
      makeActivityRunner()
    ).process(makeRequest());

    expect(response.jsonBody).toEqual(invokeResponse);
  });

  it("carries no body key at all when the adapter sent none", async () => {
    // Not "an empty body" — no key. A `jsonBody: undefined` still makes
    // Azure Functions write a JSON content type onto a 202 that has
    // nothing to say, which is a different answer than the adapter gave.
    const adapter = makeChannelRequestProcessor((response) => {
      response.status(202);
    });

    const response = await createMessagingEndpoint(
      adapter,
      makeActivityRunner()
    ).process(makeRequest());

    expect(response).not.toHaveProperty("jsonBody");
  });
});

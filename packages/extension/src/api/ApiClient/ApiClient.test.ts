import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiClient } from "./ApiClient";
import { ApiError } from "../ApiError/ApiError";
import { PR_KEY, makeRound } from "../../test/fixtures/fixtures";

// The client's whole job is to turn a call into a request and a response
// into a value or an `ApiError`, so the request it issues IS its
// behaviour: the URL, the method, the headers, the serialised body, and
// how each status is interpreted.
//
// The seam is the global `fetch`, replaced for the duration of a test and
// restored afterwards. That is the only reasonable one for a module that
// exists to construct requests — asserting through a wrapper would just be
// asserting that the wrapper was called.
//
// Responses are real `Response` objects rather than hand-shaped stubs, so
// `response.ok`, the `204` case and a body that will not parse all behave
// the way the platform behaves rather than the way a fake was written to.

const BASE_URL = "https://prsync.example.test";
const TOKEN = "fake-ado-token";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

/** Replaces the global `fetch` with one that answers with `response`. */
function stubFetch(response: Response): void {
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  globalThis.fetch = fetchMock;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The request the client issued, read back the way a server would. */
function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("fetch was never called");
  }
  const [input, init] = call;
  // `fetch` accepts three input shapes; the client only ever passes the
  // first, and narrowing rather than stringifying says so.
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return { url, init: init ?? {} };
}

function header(name: string): string | null {
  return new Headers(lastRequest().init.headers).get(name);
}

const getAccessToken = vi.fn<() => Promise<string>>();

function client() {
  return createApiClient(BASE_URL, getAccessToken);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue(TOKEN);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ApiClient.getCurrentRound", () => {
  it("GETs the PR's current round, with the PR key encoded into the path", async () => {
    stubFetch(jsonResponse(200, makeRound()));

    await client().getCurrentRound(PR_KEY);

    // The PR key is `{guid}:{guid}:{int}`, so its colons MUST be encoded
    // or the path segment breaks.
    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/prs/${encodeURIComponent(PR_KEY)}/rounds/current`
    );
    expect(lastRequest().url).toContain("%3A");
    expect(lastRequest().url).not.toMatch(/prs\/[^/]*:/);
  });

  it("carries the caller's ADO bearer token", async () => {
    stubFetch(jsonResponse(200, makeRound()));

    await client().getCurrentRound(PR_KEY);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(header("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("resolves the parsed round on 200", async () => {
    const round = makeRound();
    stubFetch(jsonResponse(200, round));

    await expect(client().getCurrentRound(PR_KEY)).resolves.toEqual(round);
  });

  it("resolves null on 204, meaning no round has ever been opened", async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(client().getCurrentRound(PR_KEY)).resolves.toBeNull();
  });

  it("rejects with an ApiError carrying the status and the body's code", async () => {
    stubFetch(jsonResponse(403, { code: "NOT_A_REVIEWER" }));

    // One call, both assertions: a `Response` body can only be read once.
    const error = await client()
      .getCurrentRound(PR_KEY)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "NOT_A_REVIEWER" });
  });

  it("yields a null code when the error body will not parse", async () => {
    // A gateway or proxy failure answers with HTML, not the service's JSON.
    // The status still has to reach `mapApiError`.
    stubFetch(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    await expect(client().getCurrentRound(PR_KEY)).rejects.toMatchObject({
      status: 502,
      code: null,
    });
  });
});

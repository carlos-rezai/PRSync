import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiClient } from "./ApiClient";
import { ApiError } from "../../lib";
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  PR_KEY,
  PR_TITLE,
  PR_URL,
  makeAdoReviewer,
  makeCancelledRound,
  makeClosedRound,
  makeRound,
} from "../../test/fixtures/fixtures";

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

/** The JSON the client serialised into the request body. */
function requestBody(): unknown {
  const body = lastRequest().init.body;
  if (typeof body !== "string") {
    throw new Error("request carried no serialised body");
  }
  return JSON.parse(body);
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

// The four mutating calls. Each asserts the same five things — the URL,
// the HTTP method, the `Content-Type`, the serialised body, and the
// returned round — because those five ARE the contract, and group 6
// collapses all four onto one shared helper afterwards.

describe("ApiClient.toggleDone", () => {
  it("PATCHes the caller's own Done state on the round", async () => {
    stubFetch(jsonResponse(200, makeClosedRound()));

    await client().toggleDone(PR_KEY, 2, true);

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/prs/${encodeURIComponent(PR_KEY)}/rounds/2/done`
    );
    expect(lastRequest().init.method).toBe("PATCH");
    expect(header("Content-Type")).toBe("application/json");
    // No reviewer id: the API targets the authenticated caller, which is
    // what makes "you can only toggle your own row" a server-side fact.
    expect(requestBody()).toEqual({ done: true });
  });

  it("resolves the authoritative round the service returns", async () => {
    // A toggle that meets quorum comes back CLOSED — the panel learns of
    // the auto-close from this response, not from a second read.
    const closed = makeClosedRound();
    stubFetch(jsonResponse(200, closed));

    await expect(client().toggleDone(PR_KEY, 2, true)).resolves.toEqual(closed);
  });

  it("rejects with an ApiError on failure", async () => {
    stubFetch(jsonResponse(409, { code: "ROUND_NOT_OPEN" }));

    const error = await client()
      .toggleDone(PR_KEY, 2, true)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "ROUND_NOT_OPEN" });
  });
});

describe("ApiClient.openRound", () => {
  const request = {
    phase: "spec" as const,
    reviewers: [makeAdoReviewer()],
    prTitle: PR_TITLE,
    prUrl: PR_URL,
    author: { name: AUTHOR_NAME, email: AUTHOR_EMAIL },
  };

  it("POSTs the snapshot to the PR's rounds collection", async () => {
    stubFetch(jsonResponse(200, makeRound()));

    await client().openRound(PR_KEY, { ...request, label: "Round 1 — Mine" });

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/prs/${encodeURIComponent(PR_KEY)}/rounds`
    );
    expect(lastRequest().init.method).toBe("POST");
    expect(header("Content-Type")).toBe("application/json");
    expect(requestBody()).toEqual({ ...request, label: "Round 1 — Mine" });
  });

  it("omits an undefined label from the body entirely", async () => {
    // The compose form's contract: an untouched label is `undefined` and
    // must DROP OUT of the JSON, so the API generates the canonical
    // wording rather than storing a client-derived copy of it.
    stubFetch(jsonResponse(200, makeRound()));

    await client().openRound(PR_KEY, { ...request, label: undefined });

    const body = requestBody();
    expect(body).toEqual(request);
    expect(Object.keys(body as object)).not.toContain("label");
  });

  it("resolves the newly opened round", async () => {
    const opened = makeRound();
    stubFetch(jsonResponse(200, opened));

    await expect(client().openRound(PR_KEY, request)).resolves.toEqual(opened);
  });

  it("rejects with an ApiError on failure", async () => {
    // The server-owned backstop to the client's `hasEligibleReviewers`
    // gate — the panel surfaces this one inline on the compose form.
    stubFetch(jsonResponse(422, { code: "INSUFFICIENT_REVIEWERS" }));

    const error = await client()
      .openRound(PR_KEY, request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: "INSUFFICIENT_REVIEWERS",
    });
  });
});

describe("ApiClient.editLabel", () => {
  it("PATCHes the round with the author's exact text", async () => {
    stubFetch(jsonResponse(200, makeRound()));

    await client().editLabel(PR_KEY, 2, "Round 2 — Please re-read the spec");

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/prs/${encodeURIComponent(PR_KEY)}/rounds/2`
    );
    expect(lastRequest().init.method).toBe("PATCH");
    expect(header("Content-Type")).toBe("application/json");
    expect(requestBody()).toEqual({
      label: "Round 2 — Please re-read the spec",
    });
  });

  it("resolves the round the service stored, not the text sent", async () => {
    const renamed = makeRound({ label: "Round 2 — Stored by the API" });
    stubFetch(jsonResponse(200, renamed));

    await expect(
      client().editLabel(PR_KEY, 2, "Round 2 — Mine")
    ).resolves.toEqual(renamed);
  });

  it("rejects with an ApiError on failure", async () => {
    stubFetch(jsonResponse(403, { code: "NOT_AUTHOR" }));

    const error = await client()
      .editLabel(PR_KEY, 2, "Round 2 — Mine")
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "NOT_AUTHOR" });
  });
});

describe("ApiClient.cancelRound", () => {
  it("POSTs to the round's cancel endpoint with no body", async () => {
    stubFetch(jsonResponse(200, makeCancelledRound()));

    await client().cancelRound(PR_KEY, 2);

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/prs/${encodeURIComponent(PR_KEY)}/rounds/2/cancel`
    );
    expect(lastRequest().init.method).toBe("POST");
    // Nothing to send: the round number in the path is the whole request.
    expect(lastRequest().init.body).toBeUndefined();
  });

  it("resolves the cancelled round", async () => {
    const cancelled = makeCancelledRound();
    stubFetch(jsonResponse(200, cancelled));

    await expect(client().cancelRound(PR_KEY, 2)).resolves.toEqual(cancelled);
  });

  it("rejects with an ApiError on failure", async () => {
    stubFetch(jsonResponse(409, { code: "ROUND_NOT_OPEN" }));

    const error = await client()
      .cancelRound(PR_KEY, 2)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "ROUND_NOT_OPEN" });
  });
});

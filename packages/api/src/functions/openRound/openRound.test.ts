import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeOpenRoundHandler } from "./openRound";
import {
  RoundService,
  RoundServiceError,
  type IdentityResolver,
} from "../../services";
import { PR_KEY } from "../../test/fixtures/fixtures";
import {
  loggedErrors,
  makeContext,
  makeIdentityResolver,
  makeRequest,
  type Faked,
  type RequestOptions,
} from "../../test/fixtures/fakes";

// Contract tests for the POST /api/prs/{prKey}/rounds entry point. The
// function layer is thin: zod-validate (reject-unknown), call the
// service, map the result/errors to HTTP. Malformed input must be
// rejected at the boundary BEFORE any service/storage call.
//
// Security hardening (issue #5): opening a round is a mutating action, so
// it requires a valid ADO bearer token (401 when unresolved) and the
// recorded author identity comes ONLY from the resolved token — the body
// carries the author's name/email as inert display/Teams data but has NO
// author `adoId` field, so authoring a round as someone else is
// inexpressible (mirrors the done-toggle rule). Tokens and reviewer
// emails must never reach the logs.

const CALLER_ADO_ID = "caller-ado-id";
const BEARER_TOKEN = "super-secret-bearer-token";
const REVIEWER_EMAIL = "r1@example.com";
const AUTHOR_EMAIL = "author@example.com";

// The author sub-object carries display/Teams data only — never an adoId.
// The authoritative author identity is the resolved caller's adoId.
function validBody() {
  return {
    phase: "implementation",
    reviewers: [
      {
        adoId: "r1",
        email: REVIEWER_EMAIL,
        displayName: "Reviewer One",
        isRequired: false,
        isContainer: false,
      },
      {
        adoId: "r2",
        email: "r2@example.com",
        displayName: "Reviewer Two",
        isRequired: false,
        isContainer: false,
      },
    ],
    prTitle: "Add round lifecycle",
    prUrl: "https://dev.azure.com/org/proj/_git/repo/pullrequest/42",
    author: {
      name: "The Author",
      email: AUTHOR_EMAIL,
    },
  };
}

function makeReq(opts: Omit<RequestOptions, "method" | "url"> = {}) {
  const { params = { prKey: PR_KEY }, ...rest } = opts;
  return makeRequest({
    method: "POST",
    url: `http://localhost/api/prs/${params.prKey}/rounds`,
    params,
    ...rest,
  });
}

let service: { openRound: ReturnType<typeof vi.fn> };
let identity: Faked<IdentityResolver>;

beforeEach(() => {
  service = { openRound: vi.fn() };
  identity = makeIdentityResolver(CALLER_ADO_ID);
});

// `RoundService` is a class with private fields, so no structural fake is
// assignable to it — the assertion is the seam, not an oversight. The
// identity resolver is an interface, so its fake needs none.
function handler() {
  return makeOpenRoundHandler(service as unknown as RoundService, identity);
}

describe("openRound handler — boundary validation (rejects before storage)", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: "not-a-key" }, body: validBody() }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.openRound).not.toHaveBeenCalled();
  });

  it("rejects an unknown body field with 400 and never calls the service", async () => {
    const res = await handler()(
      makeReq({ body: { ...validBody(), injected: "nope" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.openRound).not.toHaveBeenCalled();
  });

  it("rejects a body missing a required field with 400", async () => {
    const { reviewers: _omitted, ...withoutReviewers } = validBody();
    const res = await handler()(
      makeReq({ body: withoutReviewers }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.openRound).not.toHaveBeenCalled();
  });

  it("rejects an oversized body and never calls the service", async () => {
    const res = await handler()(
      makeReq({
        rawBody: "x".repeat(2_000_000),
        headers: { "content-length": String(2_000_000) },
      }),
      makeContext()
    );
    expect(res.status).toBe(413);
    expect(service.openRound).not.toHaveBeenCalled();
  });
});

describe("openRound handler — authentication (401)", () => {
  it("rejects a request whose identity cannot be resolved with 401 and never calls the service", async () => {
    identity.resolve.mockResolvedValue(null);

    const res = await handler()(makeReq({ body: validBody() }), makeContext());

    expect(res.status).toBe(401);
    expect(service.openRound).not.toHaveBeenCalled();
  });
});

describe("openRound handler — author identity comes from the token, never the body", () => {
  it("records the author as the resolved caller's adoId", async () => {
    identity.resolve.mockResolvedValue({ adoId: CALLER_ADO_ID });
    service.openRound.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 1,
      status: "open",
    });

    const res = await handler()(makeReq({ body: validBody() }), makeContext());

    expect(res.status).toBe(201);
    expect(identity.resolve).toHaveBeenCalled();
    expect(service.openRound).toHaveBeenCalledWith(
      PR_KEY,
      expect.objectContaining({ callerAdoId: CALLER_ADO_ID })
    );
  });

  it("rejects a body that tries to supply the author's adoId (impersonation inexpressible) with 400", async () => {
    const body = validBody();
    const res = await handler()(
      makeReq({
        body: { ...body, author: { ...body.author, adoId: "someone-else" } },
      }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.openRound).not.toHaveBeenCalled();
  });
});

describe("openRound handler — PII-safe logging", () => {
  it("never writes the bearer token or reviewer/author emails to the logs on an unexpected error; correlates on PR key", async () => {
    service.openRound.mockRejectedValue(new Error("boom"));
    const ctx = makeContext();

    await expect(
      handler()(
        makeReq({
          body: validBody(),
          headers: { authorization: `Bearer ${BEARER_TOKEN}` },
        }),
        ctx
      )
    ).rejects.toThrow();

    // The handler logs a correlation line for observability...
    expect(ctx.spies.error).toHaveBeenCalled();
    const logged = loggedErrors(ctx);
    // ...correlating on the PR key, never leaking the token or any email.
    expect(logged).toContain(PR_KEY);
    expect(logged).not.toContain(BEARER_TOKEN);
    expect(logged).not.toContain(REVIEWER_EMAIL);
    expect(logged).not.toContain(AUTHOR_EMAIL);
  });
});

describe("openRound handler — success and error mapping", () => {
  it("returns 201 with the created round on a valid request", async () => {
    service.openRound.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 1,
      status: "open",
    });

    const res = await handler()(makeReq({ body: validBody() }), makeContext());

    expect(res.status).toBe(201);
    expect(service.openRound).toHaveBeenCalledWith(PR_KEY, expect.any(Object));
    expect(res.jsonBody).toMatchObject({ roundNumber: 1, status: "open" });
  });

  it("maps ROUND_ALREADY_OPEN to 409", async () => {
    service.openRound.mockRejectedValue(
      new RoundServiceError("ROUND_ALREADY_OPEN", "already open")
    );
    const res = await handler()(makeReq({ body: validBody() }), makeContext());
    expect(res.status).toBe(409);
  });

  it("maps INSUFFICIENT_REVIEWERS to 422", async () => {
    service.openRound.mockRejectedValue(
      new RoundServiceError("INSUFFICIENT_REVIEWERS", "not enough")
    );
    const res = await handler()(makeReq({ body: validBody() }), makeContext());
    expect(res.status).toBe(422);
  });
});

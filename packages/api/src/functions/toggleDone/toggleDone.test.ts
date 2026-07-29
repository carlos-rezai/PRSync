import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeToggleDoneHandler, toggleDoneOptions } from "./toggleDone";
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

// Contract tests for the PATCH /api/prs/{prKey}/rounds/{n}/done entry
// point. The function layer is thin: validate the boundary (prKey, round
// number, and a `{ done }` body with NO reviewer id — reject-unknown),
// resolve the caller's identity via the IdentityResolver seam (401 when it
// yields nothing), call the service, and map its result/errors to HTTP.
// The 403 "not a snapshotted reviewer" check is the service's job, not the
// function's — the function never authorizes against the body.

const MAX_BODY_BYTES = 1_000_000;

function makeReq(opts: Omit<RequestOptions, "method" | "url"> = {}) {
  const { params = { prKey: PR_KEY, n: "1" }, ...rest } = opts;
  return makeRequest({
    method: "PATCH",
    url: `http://localhost/api/prs/${params.prKey}/rounds/${params.n}/done`,
    params,
    ...rest,
  });
}

let service: { toggleDone: ReturnType<typeof vi.fn> };
let identity: Faked<IdentityResolver>;

beforeEach(() => {
  service = { toggleDone: vi.fn() };
  identity = makeIdentityResolver("r1");
});

// `RoundService` is a class with private fields, so no structural fake is
// assignable to it — the assertion is the seam, not an oversight. The
// identity resolver is an interface, so its fake needs none.
function handler() {
  return makeToggleDoneHandler(service as unknown as RoundService, identity);
}

describe("toggleDone handler — boundary validation (rejects before storage)", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: "not-a-key", n: "1" }, body: { done: true } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });

  it("rejects a non-positive round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "0" }, body: { done: true } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });

  it("rejects a non-integer round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "abc" }, body: { done: true } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });

  it("rejects a body missing `done` with 400", async () => {
    const res = await handler()(makeReq({ body: {} }), makeContext());
    expect(res.status).toBe(400);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean `done` with 400", async () => {
    const res = await handler()(
      makeReq({ body: { done: "yes" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });

  it("rejects an attempt to target another reviewer via the body (no reviewer id field) with 400", async () => {
    const res = await handler()(
      makeReq({ body: { done: true, adoId: "victim" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });

  it("rejects an oversized body and never calls the service", async () => {
    const res = await handler()(
      makeReq({
        rawBody: "x".repeat(MAX_BODY_BYTES * 2),
        headers: { "content-length": String(MAX_BODY_BYTES * 2) },
      }),
      makeContext()
    );
    expect(res.status).toBe(413);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });
});

describe("toggleDone handler — authentication (401)", () => {
  it("rejects a request whose identity cannot be resolved with 401 and never calls the service", async () => {
    identity.resolve.mockResolvedValue(null);

    const res = await handler()(
      makeReq({ body: { done: true } }),
      makeContext()
    );

    expect(res.status).toBe(401);
    expect(service.toggleDone).not.toHaveBeenCalled();
  });
});

describe("toggleDone handler — PII-safe logging", () => {
  it("never writes the bearer token to the logs on an unexpected error; correlates on PR key + round number", async () => {
    const TOKEN = "super-secret-bearer-token";
    service.toggleDone.mockRejectedValue(new Error("boom"));
    const ctx = makeContext();

    await expect(
      handler()(
        makeReq({
          body: { done: true },
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
        ctx
      )
    ).rejects.toThrow();

    expect(ctx.spies.error).toHaveBeenCalled();
    const logged = loggedErrors(ctx);
    expect(logged).toContain(PR_KEY);
    expect(logged).toContain("1"); // round number correlation
    expect(logged).not.toContain(TOKEN);
  });
});

describe("toggleDone handler — success and error mapping", () => {
  it("returns 200 and toggles the RESOLVED caller (not any body field)", async () => {
    service.toggleDone.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 1,
      status: "open",
    });

    const res = await handler()(
      makeReq({ body: { done: true } }),
      makeContext()
    );

    expect(res.status).toBe(200);
    expect(identity.resolve).toHaveBeenCalled();
    expect(service.toggleDone).toHaveBeenCalledWith(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "r1",
      done: true,
    });
    expect(res.jsonBody).toMatchObject({ roundNumber: 1, status: "open" });
  });

  it("maps NOT_A_REVIEWER to 403", async () => {
    service.toggleDone.mockRejectedValue(
      new RoundServiceError("NOT_A_REVIEWER", "not a reviewer")
    );
    const res = await handler()(
      makeReq({ body: { done: true } }),
      makeContext()
    );
    expect(res.status).toBe(403);
  });

  it("maps ROUND_NOT_OPEN to 409", async () => {
    service.toggleDone.mockRejectedValue(
      new RoundServiceError("ROUND_NOT_OPEN", "not open")
    );
    const res = await handler()(
      makeReq({ body: { done: true } }),
      makeContext()
    );
    expect(res.status).toBe(409);
  });

  it("maps CONCURRENCY_EXHAUSTED to 503", async () => {
    service.toggleDone.mockRejectedValue(
      new RoundServiceError("CONCURRENCY_EXHAUSTED", "retries exhausted")
    );
    const res = await handler()(
      makeReq({ body: { done: true } }),
      makeContext()
    );
    expect(res.status).toBe(503);
  });
});

// Where this handler is mounted, pinned beside the behaviour it serves —
// see the note in openRound.test.ts for why the auth level is anonymous
// and why that is not the same as unauthenticated.

describe("toggleDone registration", () => {
  it("mounts PATCH at the round's done sub-resource", () => {
    expect(toggleDoneOptions).toMatchObject({
      methods: ["PATCH"],
      authLevel: "anonymous",
      route: "prs/{prKey}/rounds/{n}/done",
    });
  });
});

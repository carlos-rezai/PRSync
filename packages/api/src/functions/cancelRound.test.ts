import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { makeCancelRoundHandler } from "./cancelRound";
import { RoundService, RoundServiceError } from "../services/RoundService";
import type { IdentityResolver } from "../services/IdentityResolver";

// Contract tests for POST /api/prs/{prKey}/rounds/{n}/cancel. The function
// layer is thin: validate the boundary (prKey, round number), resolve the
// caller's identity via the IdentityResolver seam (401 when it yields
// nothing), call the service, and map its result/errors to HTTP. The
// author-only 403 (NOT_AUTHOR) check is the service's job — the function
// passes the resolved caller through and never authorizes itself.

const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

function makeReq(opts: {
  params?: Record<string, string>;
  headers?: Record<string, string>;
}): HttpRequest {
  const { params = { prKey: PR_KEY, n: "1" }, headers = {} } = opts;
  return {
    method: "POST",
    url: `http://localhost/api/prs/${params.prKey}/rounds/${params.n}/cancel`,
    params,
    query: new URLSearchParams(),
    headers: new Headers(headers),
    json: async () => {
      throw new Error("no json body");
    },
    text: async () => "",
  } as unknown as HttpRequest;
}

function makeCtx(): InvocationContext {
  return {
    invocationId: "test",
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  } as unknown as InvocationContext;
}

let service: { cancelRound: ReturnType<typeof vi.fn> };
let identity: { resolve: ReturnType<typeof vi.fn> };

beforeEach(() => {
  service = { cancelRound: vi.fn() };
  identity = { resolve: vi.fn().mockResolvedValue({ adoId: "author-ado-id" }) };
});

function handler() {
  return makeCancelRoundHandler(
    service as unknown as RoundService,
    identity as unknown as IdentityResolver
  );
}

describe("cancelRound handler — boundary validation (rejects before storage)", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: "not-a-key", n: "1" } }),
      makeCtx()
    );
    expect(res.status).toBe(400);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });

  it("rejects a non-positive round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "0" } }),
      makeCtx()
    );
    expect(res.status).toBe(400);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });

  it("rejects a non-integer round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "abc" } }),
      makeCtx()
    );
    expect(res.status).toBe(400);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });
});

describe("cancelRound handler — authentication (401)", () => {
  it("rejects a request whose identity cannot be resolved with 401 and never calls the service", async () => {
    identity.resolve.mockResolvedValue(null);

    const res = await handler()(makeReq({}), makeCtx());

    expect(res.status).toBe(401);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });
});

describe("cancelRound handler — success and error mapping", () => {
  it("returns 200 and cancels on behalf of the RESOLVED caller", async () => {
    service.cancelRound.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 1,
      status: "cancelled",
    });

    const res = await handler()(makeReq({}), makeCtx());

    expect(res.status).toBe(200);
    expect(identity.resolve).toHaveBeenCalled();
    expect(service.cancelRound).toHaveBeenCalledWith(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "author-ado-id",
    });
    expect(res.jsonBody).toMatchObject({ roundNumber: 1, status: "cancelled" });
  });

  it("maps NOT_AUTHOR to 403", async () => {
    service.cancelRound.mockRejectedValue(
      new RoundServiceError("NOT_AUTHOR", "not the author")
    );
    const res = await handler()(makeReq({}), makeCtx());
    expect(res.status).toBe(403);
  });

  it("maps ROUND_NOT_OPEN to 409", async () => {
    service.cancelRound.mockRejectedValue(
      new RoundServiceError("ROUND_NOT_OPEN", "not open")
    );
    const res = await handler()(makeReq({}), makeCtx());
    expect(res.status).toBe(409);
  });

  it("maps CONCURRENCY_EXHAUSTED to 503", async () => {
    service.cancelRound.mockRejectedValue(
      new RoundServiceError("CONCURRENCY_EXHAUSTED", "retries exhausted")
    );
    const res = await handler()(makeReq({}), makeCtx());
    expect(res.status).toBe(503);
  });
});

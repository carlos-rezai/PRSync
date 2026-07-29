import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCancelRoundHandler, cancelRoundOptions } from "./cancelRound";
import {
  RoundService,
  RoundServiceError,
  type IdentityResolver,
} from "../../services";
import { PR_KEY } from "../../test/fixtures/fixtures";
import {
  makeContext,
  makeIdentityResolver,
  makeRequest,
  type Faked,
  type RequestOptions,
} from "../../test/fixtures/fakes";

// Contract tests for POST /api/prs/{prKey}/rounds/{n}/cancel. The function
// layer is thin: validate the boundary (prKey, round number), resolve the
// caller's identity via the IdentityResolver seam (401 when it yields
// nothing), call the service, and map its result/errors to HTTP. The
// author-only 403 (NOT_AUTHOR) check is the service's job — the function
// passes the resolved caller through and never authorizes itself.

// Cancel carries no body at all, so `makeReq` never passes one — the
// fake's `json()` rejects, exactly as the runtime's would.
function makeReq(opts: Pick<RequestOptions, "params" | "headers"> = {}) {
  const { params = { prKey: PR_KEY, n: "1" }, headers } = opts;
  return makeRequest({
    method: "POST",
    url: `http://localhost/api/prs/${params.prKey}/rounds/${params.n}/cancel`,
    params,
    headers,
  });
}

let service: { cancelRound: ReturnType<typeof vi.fn> };
let identity: Faked<IdentityResolver>;

beforeEach(() => {
  service = { cancelRound: vi.fn() };
  identity = makeIdentityResolver("author-ado-id");
});

// `RoundService` is a class with private fields, so no structural fake is
// assignable to it — the assertion is the seam, not an oversight. The
// identity resolver is an interface, so its fake needs none.
function handler() {
  return makeCancelRoundHandler(service as unknown as RoundService, identity);
}

describe("cancelRound handler — boundary validation (rejects before storage)", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: "not-a-key", n: "1" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });

  it("rejects a non-positive round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "0" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });

  it("rejects a non-integer round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "abc" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.cancelRound).not.toHaveBeenCalled();
  });
});

describe("cancelRound handler — authentication (401)", () => {
  it("rejects a request whose identity cannot be resolved with 401 and never calls the service", async () => {
    identity.resolve.mockResolvedValue(null);

    const res = await handler()(makeReq({}), makeContext());

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

    const res = await handler()(makeReq({}), makeContext());

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
    const res = await handler()(makeReq({}), makeContext());
    expect(res.status).toBe(403);
  });

  it("maps ROUND_NOT_OPEN to 409", async () => {
    service.cancelRound.mockRejectedValue(
      new RoundServiceError("ROUND_NOT_OPEN", "not open")
    );
    const res = await handler()(makeReq({}), makeContext());
    expect(res.status).toBe(409);
  });

  it("maps CONCURRENCY_EXHAUSTED to 503", async () => {
    service.cancelRound.mockRejectedValue(
      new RoundServiceError("CONCURRENCY_EXHAUSTED", "retries exhausted")
    );
    const res = await handler()(makeReq({}), makeContext());
    expect(res.status).toBe(503);
  });
});

// Where this handler is mounted, pinned beside the behaviour it serves —
// see the note in openRound.test.ts for why the auth level is anonymous
// and why that is not the same as unauthenticated.

describe("cancelRound registration", () => {
  it("mounts POST at the round's cancel action", () => {
    expect(cancelRoundOptions).toMatchObject({
      methods: ["POST"],
      authLevel: "anonymous",
      route: "prs/{prKey}/rounds/{n}/cancel",
    });
  });
});

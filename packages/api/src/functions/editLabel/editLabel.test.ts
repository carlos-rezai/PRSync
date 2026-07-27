import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeEditLabelHandler } from "./editLabel";
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

// Contract tests for PATCH /api/prs/{prKey}/rounds/{n}. The function layer
// is thin: validate the boundary (prKey, round number, and a `{ label }`
// body — reject-unknown), resolve the caller's identity via the
// IdentityResolver seam (401 when it yields nothing), call the service, and
// map its result/errors to HTTP. The author-only 403 (NOT_AUTHOR) check is
// the service's job — the function passes the resolved caller through.

const MAX_BODY_BYTES = 1_000_000;

function makeReq(opts: Omit<RequestOptions, "method" | "url"> = {}) {
  const { params = { prKey: PR_KEY, n: "1" }, ...rest } = opts;
  return makeRequest({
    method: "PATCH",
    url: `http://localhost/api/prs/${params.prKey}/rounds/${params.n}`,
    params,
    ...rest,
  });
}

let service: { editLabel: ReturnType<typeof vi.fn> };
let identity: Faked<IdentityResolver>;

beforeEach(() => {
  service = { editLabel: vi.fn() };
  identity = makeIdentityResolver("author-ado-id");
});

// `RoundService` is a class with private fields, so no structural fake is
// assignable to it — the assertion is the seam, not an oversight. The
// identity resolver is an interface, so its fake needs none.
function handler() {
  return makeEditLabelHandler(service as unknown as RoundService, identity);
}

describe("editLabel handler — boundary validation (rejects before storage)", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(
      makeReq({
        params: { prKey: "not-a-key", n: "1" },
        body: { label: "New label" },
      }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.editLabel).not.toHaveBeenCalled();
  });

  it("rejects a non-positive round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "0" }, body: { label: "x" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.editLabel).not.toHaveBeenCalled();
  });

  it("rejects a non-integer round number with 400", async () => {
    const res = await handler()(
      makeReq({ params: { prKey: PR_KEY, n: "abc" }, body: { label: "x" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.editLabel).not.toHaveBeenCalled();
  });

  it("rejects a body missing `label` with 400", async () => {
    const res = await handler()(makeReq({ body: {} }), makeContext());
    expect(res.status).toBe(400);
    expect(service.editLabel).not.toHaveBeenCalled();
  });

  it("rejects a non-string `label` with 400", async () => {
    const res = await handler()(makeReq({ body: { label: 7 } }), makeContext());
    expect(res.status).toBe(400);
    expect(service.editLabel).not.toHaveBeenCalled();
  });

  it("rejects an unknown extra field with 400 (reject-unknown)", async () => {
    const res = await handler()(
      makeReq({ body: { label: "New label", status: "closed" } }),
      makeContext()
    );
    expect(res.status).toBe(400);
    expect(service.editLabel).not.toHaveBeenCalled();
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
    expect(service.editLabel).not.toHaveBeenCalled();
  });
});

describe("editLabel handler — authentication (401)", () => {
  it("rejects a request whose identity cannot be resolved with 401 and never calls the service", async () => {
    identity.resolve.mockResolvedValue(null);

    const res = await handler()(
      makeReq({ body: { label: "New label" } }),
      makeContext()
    );

    expect(res.status).toBe(401);
    expect(service.editLabel).not.toHaveBeenCalled();
  });
});

describe("editLabel handler — success and error mapping", () => {
  it("returns 200 and edits on behalf of the RESOLVED caller", async () => {
    service.editLabel.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 1,
      status: "open",
      label: "New label",
    });

    const res = await handler()(
      makeReq({ body: { label: "New label" } }),
      makeContext()
    );

    expect(res.status).toBe(200);
    expect(identity.resolve).toHaveBeenCalled();
    expect(service.editLabel).toHaveBeenCalledWith(PR_KEY, {
      roundNumber: 1,
      callerAdoId: "author-ado-id",
      label: "New label",
    });
    expect(res.jsonBody).toMatchObject({ roundNumber: 1, label: "New label" });
  });

  it("maps NOT_AUTHOR to 403", async () => {
    service.editLabel.mockRejectedValue(
      new RoundServiceError("NOT_AUTHOR", "not the author")
    );
    const res = await handler()(
      makeReq({ body: { label: "x" } }),
      makeContext()
    );
    expect(res.status).toBe(403);
  });

  it("maps ROUND_NOT_OPEN to 409", async () => {
    service.editLabel.mockRejectedValue(
      new RoundServiceError("ROUND_NOT_OPEN", "not open")
    );
    const res = await handler()(
      makeReq({ body: { label: "x" } }),
      makeContext()
    );
    expect(res.status).toBe(409);
  });

  it("maps CONCURRENCY_EXHAUSTED to 503", async () => {
    service.editLabel.mockRejectedValue(
      new RoundServiceError("CONCURRENCY_EXHAUSTED", "retries exhausted")
    );
    const res = await handler()(
      makeReq({ body: { label: "x" } }),
      makeContext()
    );
    expect(res.status).toBe(503);
  });
});

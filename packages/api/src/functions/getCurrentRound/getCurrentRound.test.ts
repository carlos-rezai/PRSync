import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest } from "@azure/functions";
import {
  getCurrentRoundOptions,
  makeGetCurrentRoundHandler,
} from "./getCurrentRound";
import type { IdentityResolver, RoundService } from "../../services";
import { PR_KEY } from "../../test/fixtures/fixtures";
import {
  makeContext,
  makeIdentityResolver,
  makeRequest,
  type Faked,
} from "../../test/fixtures/fakes";

// Contract tests for GET /api/prs/{prKey}/rounds/current. Returns 200
// with the latest round (any status), 204 when the PR has never had a
// round, and 400 for a malformed key — validated before any storage call.
// Security hardening (issue #5): this read serves reviewer emails (PII),
// so it requires a valid ADO bearer token exactly like the mutating
// endpoints — an unresolved identity is 401 BEFORE any storage access.

function makeReq(
  params: Record<string, string> = { prKey: PR_KEY }
): HttpRequest {
  return makeRequest({
    method: "GET",
    url: `http://localhost/api/prs/${params.prKey}/rounds/current`,
    params,
  });
}

let service: { getCurrentRound: ReturnType<typeof vi.fn> };
let identity: Faked<IdentityResolver>;

beforeEach(() => {
  service = { getCurrentRound: vi.fn() };
  identity = makeIdentityResolver("u1");
});

// `RoundService` is a class with private fields, so no structural fake is
// assignable to it — the assertion is the seam, not an oversight. The
// identity resolver is an interface, so its fake needs none.
function handler() {
  return makeGetCurrentRoundHandler(
    service as unknown as RoundService,
    identity
  );
}

describe("getCurrentRound handler — authentication (401)", () => {
  it("rejects a request whose identity cannot be resolved with 401 and never calls the service", async () => {
    identity.resolve.mockResolvedValue(null);

    const res = await handler()(makeReq(), makeContext());

    expect(res.status).toBe(401);
    expect(service.getCurrentRound).not.toHaveBeenCalled();
  });
});

describe("getCurrentRound handler — read contract (authenticated)", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(makeReq({ prKey: "not-a-key" }), makeContext());
    expect(res.status).toBe(400);
    expect(service.getCurrentRound).not.toHaveBeenCalled();
  });

  it("returns 200 with the current round when one exists", async () => {
    service.getCurrentRound.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 2,
      status: "cancelled",
    });

    const res = await handler()(makeReq(), makeContext());

    expect(res.status).toBe(200);
    expect(identity.resolve).toHaveBeenCalled();
    expect(service.getCurrentRound).toHaveBeenCalledWith(PR_KEY);
    expect(res.jsonBody).toMatchObject({ roundNumber: 2, status: "cancelled" });
  });

  it("returns 204 with no body for a PR that has never had a round", async () => {
    service.getCurrentRound.mockResolvedValue(null);

    const res = await handler()(makeReq(), makeContext());

    expect(res.status).toBe(204);
    expect(res.jsonBody).toBeUndefined();
  });
});

// Where this handler is mounted, pinned beside the behaviour it serves —
// see the note in openRound.test.ts for why the auth level is anonymous
// and why that is not the same as unauthenticated.

describe("getCurrentRound registration", () => {
  it("mounts GET at the PR's current round", () => {
    // `current` and `{n}` are siblings under `rounds/`. They never
    // collide, because this is the only GET of the five — but the fact
    // that they are distinguished by METHOD rather than by path shape is
    // the kind of thing a later route change quietly breaks.
    expect(getCurrentRoundOptions).toMatchObject({
      methods: ["GET"],
      authLevel: "anonymous",
      route: "prs/{prKey}/rounds/current",
    });
  });
});

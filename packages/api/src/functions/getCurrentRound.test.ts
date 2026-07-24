import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { makeGetCurrentRoundHandler } from "./getCurrentRound";
import { RoundService } from "../services/RoundService";

// Contract tests for GET /api/prs/{prKey}/rounds/current. Returns 200
// with the latest round (any status), 204 when the PR has never had a
// round, and 400 for a malformed key — validated before any storage call.

const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

function makeReq(
  params: Record<string, string> = { prKey: PR_KEY }
): HttpRequest {
  return {
    method: "GET",
    url: `http://localhost/api/prs/${params.prKey}/rounds/current`,
    params,
    query: new URLSearchParams(),
    headers: new Headers(),
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

let service: { getCurrentRound: ReturnType<typeof vi.fn> };

beforeEach(() => {
  service = { getCurrentRound: vi.fn() };
});

function handler() {
  return makeGetCurrentRoundHandler(service as unknown as RoundService);
}

describe("getCurrentRound handler", () => {
  it("rejects a malformed prKey with 400 and never calls the service", async () => {
    const res = await handler()(makeReq({ prKey: "not-a-key" }), makeCtx());
    expect(res.status).toBe(400);
    expect(service.getCurrentRound).not.toHaveBeenCalled();
  });

  it("returns 200 with the current round when one exists", async () => {
    service.getCurrentRound.mockResolvedValue({
      prKey: PR_KEY,
      roundNumber: 2,
      status: "cancelled",
    });

    const res = await handler()(makeReq(), makeCtx());

    expect(res.status).toBe(200);
    expect(service.getCurrentRound).toHaveBeenCalledWith(PR_KEY);
    expect(res.jsonBody).toMatchObject({ roundNumber: 2, status: "cancelled" });
  });

  it("returns 204 with no body for a PR that has never had a round", async () => {
    service.getCurrentRound.mockResolvedValue(null);

    const res = await handler()(makeReq(), makeCtx());

    expect(res.status).toBe(204);
    expect(res.jsonBody).toBeUndefined();
  });
});

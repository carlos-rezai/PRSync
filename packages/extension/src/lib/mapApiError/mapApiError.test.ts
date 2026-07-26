import { describe, it, expect } from "vitest";
import { mapApiError } from "./mapApiError";

// mapApiError is the panel's single, pure translation from an API failure
// ({ status, code }) to viewer-facing guidance ({ message, recovery }). The
// `recovery` discriminant is the behavioural contract — it tells the `App`
// what to DO (refetch / inline / retry / reload) — so it is what these tests
// pin down; `message` is asserted loosely against the wording the PRD
// mandates. Error codes come from Feature 1's RoundService (verified against
// packages/api/src/services/RoundService/RoundService.ts). Terminology:
// docs/ubiquitous-language.md.

describe("mapApiError — {status, code} → recovery guidance", () => {
  it("maps 401 to a session-expired reload", () => {
    const guidance = mapApiError(401, "Unauthenticated.");
    expect(guidance.recovery).toBe("reload");
    expect(guidance.message).toMatch(/session expired/i);
  });

  it.each([
    [403, "NOT_A_REVIEWER"],
    [403, "NOT_AUTHOR"],
    [409, "ROUND_NOT_OPEN"],
    [409, "ROUND_ALREADY_OPEN"],
  ])("maps drift-class %s %s to a self-healing refetch", (status, code) => {
    const guidance = mapApiError(status, code);
    expect(guidance.recovery).toBe("refetch");
    expect(guidance.message).toBeTruthy();
  });

  it("maps 422 INSUFFICIENT_REVIEWERS to an inline validation message", () => {
    const guidance = mapApiError(422, "INSUFFICIENT_REVIEWERS");
    expect(guidance.recovery).toBe("inline");
    expect(guidance.message).toMatch(/reviewer/i);
  });

  it("maps 503 CONCURRENCY_EXHAUSTED to a single retry", () => {
    const guidance = mapApiError(503, "CONCURRENCY_EXHAUSTED");
    expect(guidance.recovery).toBe("retry");
    expect(guidance.message).toMatch(/again/i);
  });

  it("falls back to an inline message for an unrecognized status", () => {
    const guidance = mapApiError(500, null);
    expect(guidance.recovery).toBe("inline");
    expect(guidance.message).toBeTruthy();
  });
});

// The remaining {status, code} pairs, so every branch of the table is
// pinned rather than only the ones a mutation happens to reach today.
//
// The `503` wording is the one with a trap in it: the panel auto-retries a
// `503` exactly once, so the message a viewer actually READS is the
// post-retry one. It has to tell them to try again themselves, not promise
// a retry that has already been spent.

describe("mapApiError — the rest of the table", () => {
  it("maps a 401 with no service code to a session-expired reload", () => {
    // An expired ADO bearer token has no PRSync error body to parse.
    const guidance = mapApiError(401, null);
    expect(guidance.recovery).toBe("reload");
    expect(guidance.message).toMatch(/session expired/i);
    expect(guidance.message).toMatch(/refresh/i);
  });

  it("maps a 422 with an unrecognized code to a generic inline message", () => {
    const guidance = mapApiError(422, "SOME_FUTURE_VALIDATION_CODE");
    expect(guidance.recovery).toBe("inline");
    expect(guidance.message).toBeTruthy();
    // Only INSUFFICIENT_REVIEWERS earns the reviewer-specific wording.
    expect(guidance.message).not.toMatch(/reviewer/i);
  });

  it("tells the viewer to try again once the 503 retry is spent", () => {
    const guidance = mapApiError(503, "CONCURRENCY_EXHAUSTED");
    expect(guidance.recovery).toBe("retry");
    expect(guidance.message).toMatch(/try again/i);
  });

  it("falls back to inline for an unmapped status carrying a code", () => {
    const guidance = mapApiError(404, "ROUND_NOT_FOUND");
    expect(guidance.recovery).toBe("inline");
    expect(guidance.message).toBeTruthy();
  });
});

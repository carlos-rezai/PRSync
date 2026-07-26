import { describe, it, expect } from "vitest";
import { ApiError } from "./ApiError";

// `ApiError` is the panel's only failure vocabulary from the API: the HTTP
// status and the service's machine `code`, carried together so
// `mapApiError` can route a recovery from the pair. What is asserted here
// is exactly what its consumers depend on — that both fields survive the
// throw, and that it is a real `Error` so `instanceof` narrowing in the
// container's failure routing holds.

describe("ApiError", () => {
  it("carries the status and the service code", () => {
    const error = new ApiError(409, "ROUND_NOT_OPEN");

    expect(error.status).toBe(409);
    expect(error.code).toBe("ROUND_NOT_OPEN");
  });

  it("is an Error, so `instanceof` narrowing in failure routing holds", () => {
    const error = new ApiError(500, null);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe("ApiError");
  });

  it("renders the code into the message when the response carried one", () => {
    const error = new ApiError(422, "INSUFFICIENT_REVIEWERS");

    expect(error.message).toContain("422");
    expect(error.message).toContain("INSUFFICIENT_REVIEWERS");
  });

  it("leaves the message code-free when the response carried none", () => {
    // A `null` code is the ordinary case for a network-level or otherwise
    // bodyless failure; the message must not grow an empty pair of
    // parentheses around nothing.
    const error = new ApiError(503, null);

    expect(error.code).toBeNull();
    expect(error.message).toContain("503");
    expect(error.message).not.toContain("(");
  });
});

import { describe, it, expect, vi } from "vitest";
import { withSingleRetry } from "./withSingleRetry";
import { ApiError } from "../ApiError/ApiError";

// The retry policy. "Exactly once" is the whole contract, and it cuts both
// ways: a transient conflict must be retried so momentary write contention
// never reaches the viewer, and everything else must NOT be, because a
// re-sent call that cannot succeed just doubles the damage — a `401` can
// only fail again, and a re-sent round-open would snapshot a reviewer list
// that had already moved.

const transient = () => new ApiError(503, "CONCURRENCY_EXHAUSTED");

describe("withSingleRetry", () => {
  it("passes a success through untouched", async () => {
    const mutation = vi.fn(() => Promise.resolve("the round"));

    await expect(withSingleRetry(mutation)).resolves.toBe("the round");
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when the failure is transient", async () => {
    const mutation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transient())
      .mockResolvedValue("the round");

    await expect(withSingleRetry(mutation)).resolves.toBe("the round");
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it("propagates the second failure rather than retrying again", async () => {
    // One retry, not a loop: the panel does not hammer a contended write.
    const mutation = vi.fn(() => Promise.reject(transient()));

    await expect(withSingleRetry(mutation)).rejects.toMatchObject({
      status: 503,
    });
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["401, which can only fail again", new ApiError(401, null)],
    [
      "409, which the caller self-heals instead",
      new ApiError(409, "ROUND_NOT_OPEN"),
    ],
    [
      "422, which is a rejection, not a conflict",
      new ApiError(422, "INSUFFICIENT_REVIEWERS"),
    ],
    ["500, which says nothing about being transient", new ApiError(500, null)],
  ])("never retries a %s", async (_why, error) => {
    const mutation = vi.fn(() => Promise.reject(error));

    await expect(withSingleRetry(mutation)).rejects.toBe(error);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("never retries a failure that is not an ApiError at all", async () => {
    // A network-level throw has no status to classify, so there is nothing
    // to justify a second attempt.
    const error = new TypeError("Failed to fetch");
    const mutation = vi.fn(() => Promise.reject(error));

    await expect(withSingleRetry(mutation)).rejects.toBe(error);
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "../api";
import {
  REVIEWER_ONE_ID,
  makeClosedRound,
  makeRound,
} from "../test/fixtures/fixtures";
import { makeAdo, makeApi, makeSdk, renderApp } from "../test/fixtures/fakes";
import { checkbox } from "../test/fixtures/panelDom";

// What a failed mutation does to the panel. Every mutation shares one
// contract, so it is asserted once here through the Done toggle rather
// than four times across the mutation tests.
//
// `mapApiError` turns a ({ status, code }) pair into a recovery
// discriminant, and the recovery — not the message — is the behavioural
// part: `retry` is auto-retried EXACTLY once before the viewer is told
// anything, `reload` says the session expired and re-sends nothing,
// `refetch` self-heals (asserted with the drift tests), and `inline`
// surfaces next to the control.
//
// The single retry is the interesting one: momentary write contention
// (`503 CONCURRENCY_EXHAUSTED`) is invisible when the second attempt
// lands, and once that retry is spent the next attempt is the viewer's to
// make. Nothing else is ever re-sent — a `401` can only fail again.
//
// PRD #7 "Error mapping". Terminology: docs/ubiquitous-language.md.

describe("App — error recovery routing and the single retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-retries a 503 once and surfaces nothing when the retry succeeds", async () => {
    const closed = makeClosedRound();
    const toggleDone = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, "CONCURRENCY_EXHAUSTED"))
      .mockResolvedValue(closed);
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    fireEvent.click(await screen.findByRole("checkbox", { name: /Rev One/i }));

    // Momentary write contention is invisible to the viewer.
    await waitFor(() => expect(toggleDone).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/all reviewed/i)).toBeInTheDocument();
    expect(screen.queryByText(/busy|try again/i)).not.toBeInTheDocument();
  });

  it("surfaces 'try again' once the single 503 retry is spent, reverting the flip", async () => {
    const toggleDone = vi
      .fn()
      .mockRejectedValue(new ApiError(503, "CONCURRENCY_EXHAUSTED"));
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    fireEvent.click(await screen.findByRole("checkbox", { name: /Rev One/i }));

    expect(await screen.findByText(/try again/i)).toBeInTheDocument();
    // EXACTLY one retry — the panel does not hammer a contended write.
    expect(toggleDone).toHaveBeenCalledTimes(2);
    expect(checkbox(/Rev One/i)).toHaveAttribute("aria-checked", "false");
  });

  it("tells the viewer their session expired on a 401, without retrying", async () => {
    // GREEN BEFORE THE IMPLEMENTATION — Phase 2's `routeFailure` already
    // surfaces any non-refetch guidance inline. Kept as the guard that the
    // 401 wording survives, and that the Phase 5 retry wrapper never
    // re-sends a request an expired token can only fail again.
    const toggleDone = vi.fn().mockRejectedValue(new ApiError(401, null));
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    fireEvent.click(await screen.findByRole("checkbox", { name: /Rev One/i }));

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(toggleDone).toHaveBeenCalledTimes(1);
  });
});

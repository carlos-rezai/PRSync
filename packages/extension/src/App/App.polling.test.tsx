import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { ApiError } from "../lib";
import type { Round } from "../lib";
import {
  makeClosedRound,
  makeRound,
  REVIEWER_ONE_ID,
} from "../test/fixtures/fixtures";
import { makeAdo, makeApi, makeSdk, renderApp } from "../test/fixtures/fakes";
import {
  checkbox,
  flush,
  refreshBanner,
  setTabVisibility,
  tickPoll,
} from "../test/fixtures/panelDom";

// Review is live team activity, so the round a viewer is staring at goes
// stale under them. A ~20s poll re-reads the current round and compares a
// client `roundFingerprint` against the viewer's BASELINE — the last
// authoritative state they saw or acted on. A mismatch is Drift and raises
// a refresh banner the viewer must CLICK; the panel never silently
// live-patches state under a cursor, and clicking is the only path that
// updates a drifted panel.
//
// The viewer's own mutations commit their result, which resets the
// baseline — so their own changes can never raise the banner at them.
//
// Polling is SKIPPED rather than rescheduled on three conditions: a hidden
// tab (a backgrounded panel spends nothing), a mutation of the viewer's in
// flight (a poll must not clobber an optimistic flip), and an unsettled
// panel (there is no baseline to compare against).
//
// These run on fake timers where they advance the poll, and assert only
// through rendered output and the injected `api` fake. PRD #7 "Polling" /
// "Drift detection". Terminology: docs/ubiquitous-language.md.

describe("App — polling cadence and its suspension rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setTabVisibility("visible");
  });

  it("re-reads the current round every ~20 seconds", async () => {
    const getCurrentRound = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeRound()));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound }),
      makeAdo()
    );
    await flush();

    expect(getCurrentRound).toHaveBeenCalledTimes(1);
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(2);
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(3);
  });

  it("stops polling while the tab is hidden and resumes when it returns", async () => {
    const getCurrentRound = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeRound()));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound }),
      makeAdo()
    );
    await flush();
    expect(getCurrentRound).toHaveBeenCalledTimes(1);

    // A backgrounded panel spends nothing, however long it sits there.
    setTabVisibility("hidden");
    await tickPoll(3);
    expect(getCurrentRound).toHaveBeenCalledTimes(1);

    setTabVisibility("visible");
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(2);
  });

  it("stops polling while the viewer's own mutation is in flight", async () => {
    // A deferred toggle holds the mutation open across a poll interval: a
    // poll landing here would clobber the optimistic flip.
    let resolveToggle: (round: Round) => void = () => {};
    const toggleDone = vi.fn().mockReturnValue(
      new Promise<Round>((resolve) => {
        resolveToggle = resolve;
      })
    );
    const getCurrentRound = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeRound()));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound, toggleDone }),
      makeAdo()
    );
    await flush();

    fireEvent.click(checkbox(/Rev One/i));
    await tickPoll(2);
    expect(getCurrentRound).toHaveBeenCalledTimes(1);

    // Once the PATCH settles, polling picks up again.
    resolveToggle(makeClosedRound());
    await flush();
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(2);
  });
});

describe("App — drift detection and the refresh banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setTabVisibility("visible");
  });

  it("stays quiet when a poll finds the round unchanged", async () => {
    // Every poll yields a fresh object; equal state must raise nothing.
    const getCurrentRound = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeRound()));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound }),
      makeAdo()
    );
    await flush();

    await tickPoll(2);
    expect(refreshBanner()).toBeNull();
    expect(
      screen.getByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
  });

  it("raises the refresh banner on someone else's change without patching the panel", async () => {
    // The author renamed the round from their own panel while the viewer
    // was reading it.
    const drifted = makeRound({ label: "Round 2 — Renamed by the author" });
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(makeRound()))
      .mockImplementation(() => Promise.resolve(drifted));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound }),
      makeAdo()
    );
    await flush();

    await tickPoll();

    expect(refreshBanner()).not.toBeNull();
    // The panel NEVER silently live-patches: the viewer still sees exactly
    // the state they were reading until they choose to refresh.
    expect(
      screen.getByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Round 2 — Renamed by the author")
    ).not.toBeInTheDocument();
  });

  it("re-fetches, re-renders, and dismisses itself when the banner is clicked", async () => {
    const drifted = makeRound({ label: "Round 2 — Renamed by the author" });
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(makeRound()))
      .mockImplementation(() => Promise.resolve(drifted));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound }),
      makeAdo()
    );
    await flush();
    await tickPoll();

    const banner = refreshBanner();
    expect(banner).not.toBeNull();
    const callsBeforeClick = getCurrentRound.mock.calls.length;
    fireEvent.click(banner as HTMLElement);
    await flush();

    // Clicking is the ONLY path that updates a drifted panel, and it reads
    // the true state afresh rather than applying the polled copy.
    expect(getCurrentRound.mock.calls.length).toBeGreaterThan(callsBeforeClick);
    expect(
      screen.getByText("Round 2 — Renamed by the author")
    ).toBeInTheDocument();
    expect(refreshBanner()).toBeNull();
  });

  it("resets the baseline on refresh, so the same state never re-raises the banner", async () => {
    const drifted = makeRound({ label: "Round 2 — Renamed by the author" });
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(makeRound()))
      .mockImplementation(() => Promise.resolve(drifted));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound }),
      makeAdo()
    );
    await flush();
    await tickPoll();
    const banner = refreshBanner();
    expect(banner).not.toBeNull();
    fireEvent.click(banner as HTMLElement);
    await flush();

    // The refreshed state IS the baseline now — polls over it are silent.
    await tickPoll(2);
    expect(refreshBanner()).toBeNull();
  });

  it("never raises the banner at the viewer for their own Done toggle", async () => {
    // The toggle's own reconcile is the newest state the viewer has seen,
    // so the poll that follows must find nothing to report.
    const closed = makeClosedRound();
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(makeRound()))
      .mockImplementation(() => Promise.resolve(closed));
    const toggleDone = vi
      .fn()
      .mockImplementation(() => Promise.resolve(closed));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound, toggleDone }),
      makeAdo()
    );
    await flush();

    fireEvent.click(checkbox(/Rev One/i));
    await flush();
    expect(screen.getByText(/all reviewed/i)).toBeInTheDocument();

    await tickPoll(2);
    expect(refreshBanner()).toBeNull();
  });

  it("never raises the banner after a drift-heal re-fetch", async () => {
    // A 409 already reconciled the client to the true state, so that state
    // is the viewer's baseline — the next poll has nothing new to say.
    const healed = makeClosedRound();
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(makeRound()))
      .mockImplementation(() => Promise.resolve(healed));
    const toggleDone = vi
      .fn()
      .mockRejectedValue(new ApiError(409, "ROUND_NOT_OPEN"));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApi({ getCurrentRound, toggleDone }),
      makeAdo()
    );
    await flush();

    fireEvent.click(checkbox(/Rev One/i));
    await flush();
    expect(screen.getByText(/all reviewed/i)).toBeInTheDocument();

    await tickPoll(2);
    expect(refreshBanner()).toBeNull();
  });
});

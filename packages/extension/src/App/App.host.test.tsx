import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  AUTHOR_ID,
  REVIEWER_ONE_ID,
  makeCancelledRound,
  makeRound,
} from "../test/fixtures/fixtures";
import { makeAdo, makeApi, makeSdk, renderApp } from "../test/fixtures/fakes";
import {
  confirmCancel,
  flush,
  refreshBanner,
  setTabVisibility,
  tickPoll,
} from "../test/fixtures/panelDom";

// The panel is a guest in ADO's own page, and the two ways it gives that
// away are its height and its colours. Both are the HOST's to decide;
// what the panel owes is not to fight either.
//
// Height: an ADO extension renders in an iframe the host sizes, and
// nothing the panel draws changes that height on its own. A panel that
// never asks is CLIPPED the moment it grows — a refresh banner appearing,
// a compose form replacing a cancelled round — and leaves dead space when
// it shrinks. So the panel asks the host to re-measure after every render,
// which is both the complete answer and the only one that needs no guess
// at what the new height should be.
//
// Colours: the host cascades its light/dark palette into the frame (the
// opt-in itself lives in the `sdk/` seam — see src/sdk/initPanel). A
// literal colour anywhere in the panel survives that cascade, and is
// exactly what strands a white card in a dark ADO.
//
// PRD #7 "Autosize" / "Theming". Terminology: docs/ubiquitous-language.md.

describe("App — asking the host to re-measure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sizes the frame to its content once the round renders", async () => {
    const sdk = makeSdk(REVIEWER_ONE_ID);
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    renderApp(sdk, api, makeAdo());

    // The spinner and the settled round are different heights, so the host
    // has to be told once the real content is on screen.
    await screen.findByText("Rev One");
    await waitFor(() => expect(sdk.resize).toHaveBeenCalled());
  });

  it("re-sizes when a mutation swaps the view under the viewer", async () => {
    const cancelled = makeCancelledRound();
    const sdk = makeSdk(AUTHOR_ID);
    const api = makeApi({
      getCurrentRound: vi
        .fn()
        .mockResolvedValueOnce(makeRound())
        .mockResolvedValue(cancelled),
      cancelRound: vi.fn().mockResolvedValue(cancelled),
    });
    renderApp(sdk, api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    await waitFor(() => expect(sdk.resize).toHaveBeenCalled());
    const sizedForTheRound = sdk.resize.mock.calls.length;

    confirmCancel(await screen.findByRole("dialog"));

    // The reviewer list gives way to the compose form — a different height
    // the host cannot discover for itself.
    await screen.findByRole("button", { name: /ready for review/i });
    await waitFor(() =>
      expect(sdk.resize.mock.calls.length).toBeGreaterThan(sizedForTheRound)
    );
  });
});

describe("App — asking the host to re-measure for the refresh banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setTabVisibility("visible");
  });

  it("re-sizes when the refresh banner appears", async () => {
    const drifted = makeRound({ label: "Round 2 — Renamed by the author" });
    const sdk = makeSdk(REVIEWER_ONE_ID);
    const api = makeApi({
      getCurrentRound: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(makeRound()))
        .mockImplementation(() => Promise.resolve(drifted)),
    });
    renderApp(sdk, api, makeAdo());
    await flush();

    const sizedForTheRound = sdk.resize.mock.calls.length;
    await tickPoll();

    // The banner is a whole extra row appearing below the panel; without a
    // re-measure the host frame clips it, which is precisely the row the
    // viewer has to click.
    expect(refreshBanner()).not.toBeNull();
    expect(sdk.resize.mock.calls.length).toBeGreaterThan(sizedForTheRound);
  });
});

describe("App — deferring to the host theme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hardcodes no colour of its own, so the host's theme governs the panel", async () => {
    const sdk = makeSdk(REVIEWER_ONE_ID);
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const { container } = renderApp(sdk, api, makeAdo());
    await screen.findByText("Rev One");

    // Scoped to the panel's OWN markup (`prsync-` classes): `azure-devops-ui`
    // computes its avatar colours inline by design, and those are the design
    // system's business, not ours.
    //
    // Nothing of ours hardcodes a colour today; this is the guard that it
    // stays that way. An inline style is the one thing no light/dark
    // cascade can override, so it is the one way theming gets quietly
    // undone.
    const styled = Array.from(
      container.querySelectorAll<HTMLElement>('[style][class*="prsync-"]')
    );
    for (const element of styled) {
      expect(element.getAttribute("style") ?? "").not.toMatch(
        /(?:^|;)\s*(?:color|background|background-color|border-color)\s*:\s*(?:#|rgb|hsl|white\b|black\b)/i
      );
    }
  });
});

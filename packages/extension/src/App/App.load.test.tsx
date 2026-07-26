import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import type { Round } from "../lib";
import {
  AUTHOR_ID,
  REVIEWER_ONE_ID,
  STRANGER_ID,
  makeClosedRound,
  makeRound,
} from "../test/fixtures/fixtures";
import { makeAdo, makeApi, makeSdk, renderApp } from "../test/fixtures/fakes";

// What the panel does between mounting and settling on a view.
//
// The load sequence (PRD #7 "Load sequence") is one read plus at most one
// more: `getCurrentRound` answers `200` and the whole view follows from
// the round with NO ADO call, or answers `204` and a single ADO
// `createdBy` read decides whether the viewer is the author (who gets a
// compose form) or a bystander (who gets a ZeroData empty state).
//
// Also here: which of the three views the viewer's role selects, both
// empty states, and the failed-load state.
//
// Driven entirely through injected `sdk` / `api` / `ado` fakes (design log
// 02, Q14 — no SDK is mocked, no live ADO host is contacted). Assertions
// are on what the viewer SEES and which client a path called, never on
// component internals or private state. Terminology:
// docs/ubiquitous-language.md.

describe("App — initial load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a spinner while the initial getCurrentRound is in flight", () => {
    // A promise that never resolves keeps the panel in its loading state.
    const pending = new Promise<Round | null>(() => {});
    const api = makeApi({ getCurrentRound: vi.fn().mockReturnValue(pending) });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the current round from a single 200, with NO ADO REST call", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const ado = makeAdo();
    renderApp(makeSdk(REVIEWER_ONE_ID), api, ado);

    // The round label and both reviewer personas render from the snapshot.
    expect(
      await screen.findByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.getByText("Rev One")).toBeInTheDocument();
    expect(screen.getByText("Rev Two")).toBeInTheDocument();

    // A 200 is self-sufficient — ADO's live PR is never read on load.
    expect(ado.getPullRequest).not.toHaveBeenCalled();
    expect(api.getCurrentRound).toHaveBeenCalledTimes(1);
  });

  it("derives the status pill 'N of M reviewed' while the round is open", async () => {
    // One of two reviewers is done → "1 of 2 reviewed".
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    expect(await screen.findByText(/1 of 2 reviewed/i)).toBeInTheDocument();
  });

  it("derives the status pill 'All reviewed' once the round is closed", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeClosedRound()),
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    expect(await screen.findByText(/all reviewed/i)).toBeInTheDocument();
  });

  it("renders a Bystander a fully read-only view of the open round (not ZeroData)", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    renderApp(makeSdk(STRANGER_ID), api, makeAdo());

    // The bystander still sees the round content, read-only.
    expect(await screen.findByText("Rev One")).toBeInTheDocument();
    expect(screen.queryByText(/no round yet/i)).not.toBeInTheDocument();
  });

  it("renders a ZeroData empty state for a round with no reviewers", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound({ reviewers: [] })),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    expect(await screen.findByText(/no reviewers/i)).toBeInTheDocument();
  });

  it("on 204, reads ADO createdBy once and shows the author a compose placeholder", async () => {
    const api = makeApi({ getCurrentRound: vi.fn().mockResolvedValue(null) });
    const ado = makeAdo(); // the viewer created the PR
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    expect(await screen.findByText(/no open round/i)).toBeInTheDocument();
    expect(ado.getPullRequest).toHaveBeenCalledTimes(1);
    // The author's compose placeholder is not the bystander empty state.
    expect(screen.queryByText(/no round yet/i)).not.toBeInTheDocument();
  });

  it("on 204, shows a non-author the 'No round yet' ZeroData empty state", async () => {
    const api = makeApi({ getCurrentRound: vi.fn().mockResolvedValue(null) });
    const ado = makeAdo(); // the PR was created by someone else
    renderApp(makeSdk(STRANGER_ID), api, ado);

    expect(await screen.findByText(/no round yet/i)).toBeInTheDocument();
    expect(ado.getPullRequest).toHaveBeenCalledTimes(1);
  });

  it("renders an error state when the initial load fails", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockRejectedValue(new Error("network down")),
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
  });
});

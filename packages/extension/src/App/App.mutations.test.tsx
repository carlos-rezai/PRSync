import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { ApiError } from "../api";
import type { Round } from "../lib";
import {
  AUTHOR_ID,
  PR_KEY,
  REVIEWER_ONE_ID,
  STRANGER_ID,
  makeAdoPullRequest,
  makeAdoReviewer,
  makeCancelledRound,
  makeClosedRound,
  makeRound,
} from "../test/fixtures/fixtures";
import { makeAdo, makeApi, makeSdk, renderApp } from "../test/fixtures/fakes";
import {
  checkbox,
  confirmCancel,
  readyButton,
} from "../test/fixtures/panelDom";

// The four ways a viewer changes a round, and what the panel does with
// each result. Every one of them shares a skeleton — clear the error slot,
// mark a mutation in flight, run the call, apply the returned `Round` as
// authoritative, route a failure through `mapApiError` — and differs only
// in the middle.
//
// Done toggle: a reviewer signals Done on their OWN row only. The click
// flips optimistically, `toggleDone` PATCHes (carrying no reviewer id —
// the API targets the authenticated caller), and the returned `Round`
// REPLACES panel state, which is what surfaces an auto-close the instant
// the toggle meets quorum. A failure reverts the flip.
//
// Ready for review: the author opens the NEXT round with one click. The
// compose form shows only for the author and only when no round is open (a
// `204`, or a terminal round — the compose form REPLACES the read-only
// view of a terminal round). Two ADO reads are in play, and which one
// counts is the rule that matters: the load-time read only GATES the
// button, while the snapshot handed to `openRound` is read afresh AT THE
// CLICK, so a retry can never re-snapshot a reviewer list that moved.
//
// Label edit: commits on blur or Enter with the author's EXACT text; the
// returned `Round` wins, so an API that normalises the wording is
// authoritative. The typed text is already on screen, so there is nothing
// optimistic to revert.
//
// Cancel round: reachable only through a confirmation dialog, because a
// silent abandonment must never be one misclick away. The panel's share of
// the "cancel is silent" contract is that this path goes through
// `cancelRound` alone and never through a close-producing call. The
// resulting terminal round hands the author straight to the compose form
// for round N+1.
//
// Driven entirely through injected `sdk` / `api` / `ado` fakes (design log
// 02, Q14). Assertions are on which client was called, with what, in what
// order, and what the panel did with the result — never on component
// internals — which of the three gets called, with what, in what order,
// and what the panel did with the result. Which controls a given role SEES
// is a composition rule and belongs to `RoundView`'s test; how a control
// renders what it was handed belongs to that component's. PRD #7 "Done
// toggle" / "Compose defaults". Terminology: docs/ubiquitous-language.md.

describe("App — a reviewer signalling Done", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flips optimistically, calls toggleDone, then reconciles to the returned round", async () => {
    // A deferred toggle lets us observe the optimistic flip before the PATCH
    // resolves; it then resolves with a CLOSED round (quorum met).
    let resolveToggle: (round: Round) => void = () => {};
    const toggleDone = vi.fn().mockReturnValue(
      new Promise<Round>((resolve) => {
        resolveToggle = resolve;
      })
    );
    const closed = makeClosedRound();
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    const own = await screen.findByRole("checkbox", { name: /Rev One/i });
    expect(own).toHaveAttribute("aria-checked", "false");

    fireEvent.click(own);

    // Optimistic: checked immediately, and the PATCH carries the caller's
    // intent with NO reviewer id (positional prKey, round number, done).
    expect(checkbox(/Rev One/i)).toHaveAttribute("aria-checked", "true");
    expect(toggleDone).toHaveBeenCalledWith(PR_KEY, 2, true);

    // Reconcile: the returned closed round flips the pill and freezes the
    // whole list — the auto-close is surfaced immediately.
    resolveToggle(closed);
    expect(await screen.findByText(/all reviewed/i)).toBeInTheDocument();
    expect(checkbox(/Rev One/i)).toHaveAttribute("aria-disabled", "true");
  });

  it("reverts the optimistic flip and shows an inline message when the toggle fails", async () => {
    const getCurrentRound = vi.fn().mockResolvedValue(makeRound());
    const toggleDone = vi.fn().mockRejectedValue(new ApiError(500, null));
    const api = makeApi({ getCurrentRound, toggleDone });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    const own = await screen.findByRole("checkbox", { name: /Rev One/i });
    fireEvent.click(own);

    // The optimistic flip happens...
    expect(checkbox(/Rev One/i)).toHaveAttribute("aria-checked", "true");

    // ...then reverts once the PATCH rejects, with an inline recovery hint.
    await waitFor(() =>
      expect(checkbox(/Rev One/i)).toHaveAttribute("aria-checked", "false")
    );
    expect(
      screen.getByText(/couldn't|could not|failed|try again|went wrong/i)
    ).toBeInTheDocument();

    // A generic failure must NOT trigger a drift re-fetch.
    expect(getCurrentRound).toHaveBeenCalledTimes(1);
  });

  it.each([
    [409, "ROUND_NOT_OPEN"],
    [403, "NOT_A_REVIEWER"],
  ])(
    "self-heals via a re-fetch when toggleDone drifts (%s %s)",
    async (status, code) => {
      const open = makeRound();
      // The true state the re-fetch discovers: the round already closed.
      const healed = makeClosedRound();
      const getCurrentRound = vi
        .fn()
        .mockResolvedValueOnce(open) // initial load
        .mockResolvedValueOnce(healed); // drift re-fetch
      const toggleDone = vi.fn().mockRejectedValue(new ApiError(status, code));
      const api = makeApi({ getCurrentRound, toggleDone });
      renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

      const own = await screen.findByRole("checkbox", { name: /Rev One/i });
      fireEvent.click(own);

      // The drift maps (via mapApiError) to a re-fetch that reconciles the
      // client to the true, closed state — the panel self-heals.
      expect(await screen.findByText(/all reviewed/i)).toBeInTheDocument();
      await waitFor(() => expect(getCurrentRound).toHaveBeenCalledTimes(2));
      expect(checkbox(/Rev One/i)).toHaveAttribute("aria-disabled", "true");
    }
  );
});

describe("App — the author opening the next round", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the author the compose form (phase toggle + Ready) on a 204", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null), // 204 → no round
      openRound: vi.fn(),
    });
    const ado = makeAdo(); // the viewer created the PR
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    // A 204 plus an author is the one combination that composes.
    expect(
      await screen.findByRole("button", { name: /ready for review/i })
    ).toBeInTheDocument();
  });

  it("shows no Ready for review button to a non-author on a 204", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn(),
    });
    const ado = makeAdo(); // the PR was created by someone else
    renderApp(makeSdk(STRANGER_ID), api, ado);

    expect(await screen.findByText(/no round yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ready for review/i })
    ).not.toBeInTheDocument();
  });

  it("shows no Ready for review button to the author while a round is open", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()), // open round
      openRound: vi.fn(),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    // The open round renders (for the author the label is an edit
    // field); a second round can't be opened concurrently.
    expect(
      await screen.findByDisplayValue("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ready for review/i })
    ).not.toBeInTheDocument();
  });

  it("reads ADO live at the click, THEN calls api.openRound with that snapshot", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const rev = makeAdoReviewer({
      adoId: REVIEWER_ONE_ID,
      displayName: "Rev One",
    });
    const ado = makeAdo(makeAdoPullRequest({ reviewers: [rev] }));
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(api.openRound).toHaveBeenCalledTimes(1));

    // The click read ADO afresh (in addition to the compose-gate read),
    // and api.openRound got the live reviewers + title + url + author.
    expect(ado.getPullRequest).toHaveBeenCalledTimes(2);
    expect(api.openRound).toHaveBeenCalledWith(
      PR_KEY,
      expect.objectContaining({
        phase: "spec",
        reviewers: [rev],
        prTitle: "Add the widget",
        prUrl: "https://example.com/pr/42",
        author: { name: "The Author", email: "author@example.com" },
      })
    );

    // Sequencing: the fresh ADO read precedes the api.openRound call.
    const lastAdoRead = ado.getPullRequest.mock.invocationCallOrder.at(
      -1
    ) as number;
    const openCall = api.openRound.mock.invocationCallOrder[0] as number;
    expect(lastAdoRead).toBeLessThan(openCall);
  });

  it("omits the label when the author leaves it untouched", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(api.openRound).toHaveBeenCalledTimes(1));
    // Untouched → label omitted so the API generates it canonically.
    expect(api.openRound.mock.calls[0]?.[1].label).toBeUndefined();
  });

  it("sends the exact label text when the author edits it", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    await screen.findByRole("button", { name: /ready for review/i });
    const label = screen.getByRole("textbox");
    fireEvent.change(label, { target: { value: "Round 1 — Please look" } });

    fireEvent.click(readyButton());

    await waitFor(() => expect(api.openRound).toHaveBeenCalledTimes(1));
    expect(api.openRound.mock.calls[0]?.[1].label).toBe(
      "Round 1 — Please look"
    );
  });

  it("defaults the phase to spec on a 204 (no previous round)", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(api.openRound).toHaveBeenCalledTimes(1));
    expect(api.openRound.mock.calls[0]?.[1].phase).toBe("spec");
  });

  it("defaults the phase to the previous round's phase on a closed round", async () => {
    // The author views a terminal (closed) round → compose the NEXT round.
    const closed = makeClosedRound();
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(closed),
      openRound: vi.fn().mockResolvedValue(makeRound({ roundNumber: 3 })),
    });
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    // The compose form replaces the read-only closed view for the author,
    // and reads ADO once up front to gate the button.
    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(api.openRound).toHaveBeenCalledTimes(1));
    expect(api.openRound.mock.calls[0]?.[1].phase).toBe("implementation");
  });

  it("disables Ready with a hint when the snapshot has zero eligible reviewers", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn(),
    });
    // Only a container (team) and the author himself — no eligible individual.
    const ado = makeAdo(
      makeAdoPullRequest({
        reviewers: [
          makeAdoReviewer({
            adoId: "team-guid",
            displayName: "The Team",
            isContainer: true,
          }),
          makeAdoReviewer({ adoId: AUTHOR_ID, displayName: "The Author" }),
        ],
      })
    );
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    // The App gates the form on `hasEligibleReviewers` over the LIVE PR;
    // how the form renders that gate is ComposeForm's own test.
    const ready = await screen.findByRole("button", {
      name: /ready for review/i,
    });
    expect(ready).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(ready);
    expect(api.openRound).not.toHaveBeenCalled();
  });

  it("maps a 422 INSUFFICIENT_REVIEWERS to an inline validation message", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi
        .fn()
        .mockRejectedValue(new ApiError(422, "INSUFFICIENT_REVIEWERS")),
    });
    // Client pre-check passes (one eligible reviewer), so the button is
    // enabled — the server's 422 is the authoritative backstop.
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(api.openRound).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/eligible reviewer/i)).toBeInTheDocument();
  });

  it("reconciles to the returned open round after a successful openRound", async () => {
    const opened = makeRound(); // open, "1 of 2 reviewed"
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn().mockResolvedValue(opened),
    });
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    // The returned Round replaces panel state — the new open round renders,
    // with its label in the author's edit field.
    expect(
      await screen.findByDisplayValue("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 reviewed/i)).toBeInTheDocument();
  });
});

describe("App — the author renaming an open round", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits the exact edited text on blur", async () => {
    const editLabel = vi.fn().mockResolvedValue(makeRound());
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    const field = await screen.findByRole("textbox");
    fireEvent.change(field, {
      target: { value: "Round 2 — Please re-read the spec" },
    });
    fireEvent.blur(field);

    // The author's exact text is honored — no re-derivation, no trimming
    // of their wording into the canonical format.
    await waitFor(() =>
      expect(editLabel).toHaveBeenCalledWith(
        PR_KEY,
        2,
        "Round 2 — Please re-read the spec"
      )
    );
  });

  it("replaces panel state with the round editLabel returns", async () => {
    // The API is authoritative on the stored wording.
    const renamed = makeRound({ label: "Round 2 — Stored by the API" });
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel: vi.fn().mockResolvedValue(renamed),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    const field = await screen.findByRole("textbox");
    fireEvent.change(field, { target: { value: "Round 2 — My rename" } });
    fireEvent.blur(field);

    expect(
      await screen.findByDisplayValue("Round 2 — Stored by the API")
    ).toBeInTheDocument();
  });

  it("shows an inline message and leaves the round intact when the edit fails", async () => {
    const getCurrentRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApi({
      getCurrentRound,
      editLabel: vi.fn().mockRejectedValue(new ApiError(500, null)),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    const field = await screen.findByRole("textbox");
    fireEvent.change(field, { target: { value: "Round 2 — My rename" } });
    fireEvent.blur(field);

    expect(
      await screen.findByText(/couldn't|could not|failed|try again|went wrong/i)
    ).toBeInTheDocument();
    // A generic failure must NOT trigger a drift re-fetch, and the round
    // itself is untouched.
    expect(getCurrentRound).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 of 2 reviewed/i)).toBeInTheDocument();
  });

  it.each([
    [409, "ROUND_NOT_OPEN"],
    [403, "NOT_AUTHOR"],
  ])(
    "self-heals via a re-fetch when editLabel drifts (%s %s)",
    async (status, code) => {
      // The true state the re-fetch discovers: someone already closed it.
      const healed = makeClosedRound();
      const getCurrentRound = vi
        .fn()
        .mockResolvedValueOnce(makeRound()) // initial load
        .mockResolvedValue(healed); // drift re-fetch
      const api = makeApi({
        getCurrentRound,
        editLabel: vi.fn().mockRejectedValue(new ApiError(status, code)),
      });
      renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

      const field = await screen.findByRole("textbox");
      fireEvent.change(field, { target: { value: "Round 2 — My rename" } });
      fireEvent.blur(field);

      // The drift maps (via mapApiError) to a re-fetch that reconciles the
      // client to the true, closed state — which for the author is the
      // compose form for the next round.
      await waitFor(() => expect(getCurrentRound).toHaveBeenCalledTimes(2));
      expect(
        await screen.findByRole("button", { name: /ready for review/i })
      ).toBeInTheDocument();
    }
  );
});

describe("App — the author cancelling an open round", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls cancelRound — and nothing that could close the round — on confirm", async () => {
    const cancelled = makeCancelledRound();
    const cancelRound = vi.fn().mockResolvedValue(cancelled);
    const toggleDone = vi.fn();
    const api = makeApi({
      getCurrentRound: vi
        .fn()
        .mockResolvedValueOnce(makeRound())
        .mockResolvedValue(cancelled),
      cancelRound,
      toggleDone,
      openRound: vi.fn(),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    confirmCancel(await screen.findByRole("dialog"));

    await waitFor(() => expect(cancelRound).toHaveBeenCalledWith(PR_KEY, 2));
    // Cancel is a silent abandonment: it routes through the cancel
    // endpoint alone, never a close-producing call.
    expect(toggleDone).not.toHaveBeenCalled();
    expect(api.openRound).not.toHaveBeenCalled();
  });

  it("reflects the cancelled round and offers the author round N+1", async () => {
    const cancelled = makeCancelledRound();
    const api = makeApi({
      getCurrentRound: vi
        .fn()
        .mockResolvedValueOnce(makeRound()) // open, before the cancel
        .mockResolvedValue(cancelled), // terminal, after it
      cancelRound: vi.fn().mockResolvedValue(cancelled),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    confirmCancel(await screen.findByRole("dialog"));

    // The cancelled round is terminal, so the author can immediately
    // compose the next one — pre-filled for round 3, same phase.
    expect(
      await screen.findByRole("button", { name: /ready for review/i })
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Round 3 — Implementation Review")
    ).toBeInTheDocument();
  });

  it("shows an inline message and leaves the round open when the cancel fails", async () => {
    const getCurrentRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApi({
      getCurrentRound,
      cancelRound: vi.fn().mockRejectedValue(new ApiError(500, null)),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    confirmCancel(await screen.findByRole("dialog"));

    expect(
      await screen.findByText(/couldn't|could not|failed|try again|went wrong/i)
    ).toBeInTheDocument();
    // The round survives a failed cancel, and no drift re-fetch fires.
    expect(screen.getByText(/1 of 2 reviewed/i)).toBeInTheDocument();
    expect(getCurrentRound).toHaveBeenCalledTimes(1);
  });

  it("self-heals via a re-fetch when cancelRound drifts (409 ROUND_NOT_OPEN)", async () => {
    // Someone met quorum first: the round closed before the cancel landed.
    const healed = makeClosedRound();
    const getCurrentRound = vi
      .fn()
      .mockResolvedValueOnce(makeRound())
      .mockResolvedValue(healed);
    const api = makeApi({
      getCurrentRound,
      cancelRound: vi
        .fn()
        .mockRejectedValue(new ApiError(409, "ROUND_NOT_OPEN")),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    confirmCancel(await screen.findByRole("dialog"));

    // The drift maps to a re-fetch that reconciles the client to the true,
    // closed state — which for the author is the compose form for round 3.
    await waitFor(() => expect(getCurrentRound).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: /ready for review/i })
    ).toBeInTheDocument();
  });
});

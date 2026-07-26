import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { ApiError } from "../api";
import type { Round } from "../lib";
import {
  AUTHOR_ID,
  CLOSED_AT,
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
  flush,
  readyButton,
  refreshBanner,
  setTabVisibility,
  tickPoll,
} from "../test/fixtures/panelDom";

// Behavioural tests over the App container's load state machine, driven
// entirely through injected `sdk` / `api` / `ado` fakes (the PRD's
// testing seam — no SDK is mocked, no live ADO host is contacted). We
// assert what the viewer SEES and which injected clients a load path
// calls, never internal component structure or private state.
//
// Load sequence (PRD #7 "Load sequence"):
//   getCurrentRound → 200 → derive view from the round, NO ADO call
//                   → 204 → one ADO createdBy read decides author vs.
//                           bystander
// Terminology: docs/ubiquitous-language.md.

// --- Phase 2: Done toggle --------------------------------------------
//
// A reviewer signals Done on the open round from their OWN row only. The
// click flips optimistically, calls `toggleDone` (carrying no reviewer id —
// the API targets the authenticated caller), then REPLACES panel state with
// the returned `Round` (authoritative — surfaces an auto-close the moment
// the toggle meets quorum, freezing the whole list). On error the flip
// reverts with an inline message; a drift-class 409/403 maps via
// `mapApiError` to a re-fetch that self-heals the client. Every assertion is
// through the injected `api` fake and the rendered checkboxes — never
// component internals. Issue #9 / PRD #7 "Done toggle". Terminology:
// docs/ubiquitous-language.md.

describe("App — Phase 2 Done toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes only the reviewer's own row interactive while the round is open", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone: vi.fn(),
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    // The viewer's own row is interactive; the other reviewer's is not.
    const own = await screen.findByRole("checkbox", { name: /Rev One/i });
    expect(own).toHaveAttribute("aria-disabled", "false");
    expect(checkbox(/Rev Two/i)).toHaveAttribute("aria-disabled", "true");

    // Clicking someone else's row can never signal Done on their behalf.
    fireEvent.click(checkbox(/Rev Two/i));
    expect(api.toggleDone).not.toHaveBeenCalled();
  });

  it("shows the author and the bystander every Done checkbox read-only", async () => {
    for (const viewer of [AUTHOR_ID, STRANGER_ID]) {
      const api = makeApi({
        getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
        toggleDone: vi.fn(),
      });
      const { unmount } = renderApp(makeSdk(viewer), api, makeAdo());

      const one = await screen.findByRole("checkbox", { name: /Rev One/i });
      expect(one).toHaveAttribute("aria-disabled", "true");
      expect(checkbox(/Rev Two/i)).toHaveAttribute("aria-disabled", "true");
      unmount();
    }
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

  it("freezes the reviewer's own checkbox once the round is closed", async () => {
    const toggleDone = vi.fn();
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeClosedRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo());

    const own = await screen.findByRole("checkbox", { name: /Rev One/i });
    expect(own).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(own);
    expect(toggleDone).not.toHaveBeenCalled();
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

// --- Phase 3: Ready for review ---------------------------------------
//
// The author opens the NEXT round with one click. The compose form (phase
// toggle + pre-filled label + primary "Ready for review") shows ONLY for
// the author and ONLY when no round is open (a 204, or a terminal
// closed/cancelled round — per the design decision, the compose form
// REPLACES the read-only closed view for the author). Two ADO reads are in
// play: one when the compose form is shown (to gate the button on eligible
// reviewers), and a fresh authoritative one at the instant "Ready for
// review" is clicked, whose reviewers/title/url are handed to `openRound`.
//
// Rules under test (issue #10 / PRD #7 Phase 3):
//   - phase defaults to the previous round's phase, or `spec` when none;
//   - clicking reads ADO live, THEN calls `openRound` with that snapshot;
//   - the label default is derived — omitted when untouched, exact when
//     edited (so the panel and DB never diverge on wording);
//   - the button is disabled with a hint when the fresh snapshot has zero
//     eligible individual reviewers besides the author;
//   - a `422 INSUFFICIENT_REVIEWERS` maps to an inline validation message
//     (the server-owned backstop).
// Every assertion is through the injected `sdk`/`api`/`ado` fakes and the
// rendered controls — never component internals. Terminology:
// docs/ubiquitous-language.md.

describe("App — Phase 3 Ready for review", () => {
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

    // Both phase options and the primary action are present and enabled.
    const ready = await screen.findByRole("button", {
      name: /ready for review/i,
    });
    expect(ready).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: /use case review/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /implementation review/i })
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

    // The open round renders (for the author the label is the Phase 4
    // edit field); a second round can't be opened concurrently.
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

  it("flips the phase sent when the author toggles to Implementation Review", async () => {
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(null), // 204 → default spec
      openRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const ado = makeAdo();
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    await screen.findByRole("button", { name: /ready for review/i });
    fireEvent.click(
      screen.getByRole("button", { name: /implementation review/i })
    );
    fireEvent.click(readyButton());

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

    const ready = await screen.findByRole("button", {
      name: /ready for review/i,
    });
    expect(ready).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/eligible reviewer/i)).toBeInTheDocument();

    // A disabled primary action can never fire the open call.
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
    // with its label in the author's Phase 4 edit field.
    expect(
      await screen.findByDisplayValue("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 reviewed/i)).toBeInTheDocument();
  });
});

// --- Phase 4: Label edit + Cancel round -------------------------------
//
// The author's two management actions on an OPEN round.
//
// Label edit: the round label is an inline-editable `TextField` for the
// author while the round is `open`, display-only for everyone else. The
// edit commits on blur OR Enter and calls `editLabel` with the EXACT text
// the author typed; the returned `Round` replaces panel state (so an API
// that normalises the wording wins). The typed text is already on screen,
// so there is no optimistic write to revert — a failure surfaces inline
// and leaves the round untouched.
//
// Cancel round: a danger `Button` shown only to the author and only while
// `open`. It opens a "Cancel round?" confirmation `Dialog` — the endpoint
// is NOT reachable by a single misclick — and only confirming calls
// `cancelRound`. Cancelling is a SILENT abandonment: the panel's share of
// that contract is that this path goes through `cancelRound` alone and
// never through a close-producing call (the notification silence itself is
// Feature 1's, already covered in packages/api). Once cancelled the round
// is terminal, so the author immediately gets the compose form for round
// N+1 — the full open → cancelled → open cycle from the panel.
//
// Both mutations reuse the Phase 2 error contract: a generic failure shows
// an inline message and leaves panel state intact; a drift-class 409/403
// maps (via `mapApiError`) to a re-fetch that self-heals the client.
//
// Issue #11 / PRD #7 Phase 4. Terminology: docs/ubiquitous-language.md.

describe("App — Phase 4 label edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes the label editable for the author alone on an open round", async () => {
    // Both sides of the gate in one test: the author gets a field holding
    // the stored label; a reviewer and a bystander get read-only text.
    const authorApi = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const authorView = renderApp(makeSdk(AUTHOR_ID), authorApi, makeAdo());

    expect(await screen.findByRole("textbox")).toHaveValue(
      "Round 2 — Implementation Review"
    );
    authorView.unmount();

    for (const viewer of [REVIEWER_ONE_ID, STRANGER_ID]) {
      const api = makeApi({
        getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      });
      const { unmount } = renderApp(makeSdk(viewer), api, makeAdo());

      expect(
        await screen.findByText("Round 2 — Implementation Review")
      ).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the label as read-only text once the round is no longer open", async () => {
    // A terminal round can't be renamed by anyone. The author's view of a
    // terminal round is the compose form, so a bystander is the viewer that
    // still renders the round itself. GREEN BEFORE THE IMPLEMENTATION —
    // kept as the guard that the edit field never leaks past `open`.
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeCancelledRound()),
    });
    renderApp(makeSdk(STRANGER_ID), api, makeAdo());

    expect(
      await screen.findByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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

  it("commits the exact edited text on Enter", async () => {
    const editLabel = vi.fn().mockResolvedValue(makeRound());
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    const field = await screen.findByRole("textbox");
    fireEvent.change(field, { target: { value: "Round 2 — Second pass" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(editLabel).toHaveBeenCalledWith(PR_KEY, 2, "Round 2 — Second pass")
    );
  });

  it("does not call editLabel when the author commits an unchanged label", async () => {
    const editLabel = vi.fn();
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    // Focusing and leaving the field without typing is not an edit.
    const field = await screen.findByRole("textbox");
    fireEvent.blur(field);
    fireEvent.keyDown(field, { key: "Enter" });

    expect(editLabel).not.toHaveBeenCalled();
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

describe("App — Phase 4 cancel round", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Cancel round to the author alone on an open round", async () => {
    // Both sides of the gate in one test: the author gets the control, a
    // reviewer and a bystander never do.
    const authorApi = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const authorView = renderApp(makeSdk(AUTHOR_ID), authorApi, makeAdo());

    expect(
      await screen.findByRole("button", { name: /cancel round/i })
    ).toBeInTheDocument();
    authorView.unmount();

    for (const viewer of [REVIEWER_ONE_ID, STRANGER_ID]) {
      const api = makeApi({
        getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      });
      const { unmount } = renderApp(makeSdk(viewer), api, makeAdo());

      expect(await screen.findByText("Rev One")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /cancel round/i })
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("hides Cancel round once the round is no longer open", async () => {
    // Terminal rounds can't be cancelled — for the author the compose form
    // replaces the view entirely, and it carries no cancel control. GREEN
    // BEFORE THE IMPLEMENTATION — kept as the guard that the control never
    // leaks past `open`.
    const api = makeApi({
      getCurrentRound: vi
        .fn()
        .mockResolvedValue(
          makeRound({ status: "closed", closedAt: CLOSED_AT })
        ),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    await screen.findByRole("button", { name: /ready for review/i });
    expect(
      screen.queryByRole("button", { name: /cancel round/i })
    ).not.toBeInTheDocument();
  });

  it("opens a confirmation dialog without cancelling anything", async () => {
    const cancelRound = vi.fn();
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      cancelRound,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );

    // A silent abandonment is never one misclick away.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(cancelRound).not.toHaveBeenCalled();
  });

  it("dismisses the confirmation without cancelling", async () => {
    const cancelRound = vi.fn();
    const api = makeApi({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      cancelRound,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /keep round/i })
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(cancelRound).not.toHaveBeenCalled();
    // The round is still open and untouched.
    expect(screen.getByText(/1 of 2 reviewed/i)).toBeInTheDocument();
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

// --- Phase 6: Theming + autosize --------------------------------------
//
// The panel is a guest in ADO's own page, and the two ways it gives that
// away are its height and its colours.
//
// Height: an ADO extension renders in an iframe the HOST sizes. Nothing the
// panel draws changes that height on its own, so a panel that never asks is
// clipped the moment it grows — a refresh banner appearing, a compose form
// replacing a cancelled round — and leaves dead space when it shrinks. What
// the App owes is to ask the host to re-measure whenever what it renders
// changes.
//
// Colours: the host cascades its light/dark palette into the frame (the
// opt-in itself lives in the `sdk/` seam — see src/sdk/initPanel). A
// literal colour anywhere in the panel survives that cascade and is exactly
// what strands a white card in a dark ADO.
//
// Issue #13 / PRD #7 Phase 6. Terminology: docs/ubiquitous-language.md.

describe("App — Phase 6 autosize", () => {
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

describe("App — Phase 6 autosize on drift", () => {
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

describe("App — Phase 6 theming", () => {
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
    // GREEN BEFORE THE IMPLEMENTATION — nothing of ours hardcodes a colour
    // today. Kept as the guard that Phase 6's theming can't be quietly
    // undone by an inline style, which no light/dark cascade can override.
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App";
import type { SdkClient } from "../sdk";
import type { ApiClient } from "../api";
import { ApiError } from "../api";
import type { AdoClient } from "../ado";
import type { Round, RoundReviewer } from "../lib";

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

const PROJECT_ID = "6f5e4d3c-2b1a-0908-1716-2524232221f0";
const REPO_ID = "aabbccdd-eeff-0011-2233-445566778899";

const AUTHOR_ID = "author-guid-0000-0000-0000-000000000001";
const REVIEWER_ONE_ID = "reviewer1-guid-0000-0000-0000-0000000002";
const REVIEWER_TWO_ID = "reviewer2-guid-0000-0000-0000-0000000003";
const STRANGER_ID = "stranger-guid-0000-0000-0000-000000000004";

function makeReviewer(
  adoId: string,
  displayName: string,
  done: boolean
): RoundReviewer {
  return {
    adoId,
    email: `${displayName.toLowerCase().replace(/\s+/g, "")}@example.com`,
    displayName,
    isRequired: true,
    done,
    doneAt: done ? "2026-07-25T01:00:00.000Z" : undefined,
    teamsIdOverride: null,
  };
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    prKey: `${PROJECT_ID}:${REPO_ID}:42`,
    roundNumber: 2,
    phase: "implementation",
    label: "Round 2 — Implementation Review",
    status: "open",
    quorum: 2,
    reviewers: [
      makeReviewer(REVIEWER_ONE_ID, "Rev One", false),
      makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
    ],
    prTitle: "Add the widget",
    prUrl: "https://example.com/pr/42",
    authorAdoId: AUTHOR_ID,
    authorName: "The Author",
    authorEmail: "author@example.com",
    openedAt: "2026-07-25T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

// --- injected client fakes -------------------------------------------

function makeSdk(viewerAdoId: string): SdkClient {
  return {
    getUser: () => ({ id: viewerAdoId, displayName: "Viewer" }),
    prKeyParts: () => ({
      projectId: PROJECT_ID,
      repositoryId: REPO_ID,
      pullRequestId: 42,
    }),
    getAccessToken: vi.fn().mockResolvedValue("fake-token"),
  };
}

function makeApi(getCurrentRound: ApiClient["getCurrentRound"]): ApiClient {
  return { getCurrentRound } as ApiClient;
}

function makeAdo(createdByAdoId: string): AdoClient {
  return {
    getPullRequest: vi.fn().mockResolvedValue({
      createdByAdoId,
      reviewers: [],
      title: "Add the widget",
      url: "https://example.com/pr/42",
    }),
  } as unknown as AdoClient;
}

function renderApp(sdk: SdkClient, api: ApiClient, ado: AdoClient) {
  return render(<App sdk={sdk} api={api} ado={ado} />);
}

describe("App — Phase 1 read-only load paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a spinner while the initial getCurrentRound is in flight", () => {
    // A promise that never resolves keeps the panel in its loading state.
    const pending = new Promise<Round | null>(() => {});
    const api = makeApi(vi.fn().mockReturnValue(pending));
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the current round from a single 200, with NO ADO REST call", async () => {
    const api = makeApi(vi.fn().mockResolvedValue(makeRound()));
    const ado = makeAdo(AUTHOR_ID);
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
    const api = makeApi(vi.fn().mockResolvedValue(makeRound()));
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

    expect(await screen.findByText(/1 of 2 reviewed/i)).toBeInTheDocument();
  });

  it("derives the status pill 'All reviewed' once the round is closed", async () => {
    const closed = makeRound({
      status: "closed",
      closedAt: "2026-07-25T02:00:00.000Z",
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
      ],
    });
    const api = makeApi(vi.fn().mockResolvedValue(closed));
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

    expect(await screen.findByText(/all reviewed/i)).toBeInTheDocument();
  });

  it("renders a Bystander a fully read-only view of the open round (not ZeroData)", async () => {
    const api = makeApi(vi.fn().mockResolvedValue(makeRound()));
    renderApp(makeSdk(STRANGER_ID), api, makeAdo(AUTHOR_ID));

    // The bystander still sees the round content, read-only.
    expect(await screen.findByText("Rev One")).toBeInTheDocument();
    expect(screen.queryByText(/no round yet/i)).not.toBeInTheDocument();
  });

  it("renders a ZeroData empty state for a round with no reviewers", async () => {
    const api = makeApi(
      vi.fn().mockResolvedValue(makeRound({ reviewers: [] }))
    );
    renderApp(makeSdk(AUTHOR_ID), api, makeAdo(AUTHOR_ID));

    expect(await screen.findByText(/no reviewers/i)).toBeInTheDocument();
  });

  it("on 204, reads ADO createdBy once and shows the author a compose placeholder", async () => {
    const api = makeApi(vi.fn().mockResolvedValue(null)); // 204 → null
    const ado = makeAdo(AUTHOR_ID); // viewer created the PR
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    expect(await screen.findByText(/no open round/i)).toBeInTheDocument();
    expect(ado.getPullRequest).toHaveBeenCalledTimes(1);
    // The author's compose placeholder is not the bystander empty state.
    expect(screen.queryByText(/no round yet/i)).not.toBeInTheDocument();
  });

  it("on 204, shows a non-author the 'No round yet' ZeroData empty state", async () => {
    const api = makeApi(vi.fn().mockResolvedValue(null)); // 204 → null
    const ado = makeAdo(AUTHOR_ID); // PR created by someone else
    renderApp(makeSdk(STRANGER_ID), api, ado);

    expect(await screen.findByText(/no round yet/i)).toBeInTheDocument();
    expect(ado.getPullRequest).toHaveBeenCalledTimes(1);
  });

  it("renders an error state when the initial load fails", async () => {
    const api = makeApi(vi.fn().mockRejectedValue(new Error("network down")));
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
  });
});

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

// The canonical PR key the panel builds from the contribution context —
// the exact {guid}:{guid}:{int} string toggleDone must be called with.
const PR_KEY = `${PROJECT_ID}:${REPO_ID}:42`;

function makeApiP2(opts: {
  getCurrentRound: ApiClient["getCurrentRound"];
  toggleDone: (
    prKey: string,
    roundNumber: number,
    done: boolean
  ) => Promise<Round>;
}): ApiClient {
  return opts as unknown as ApiClient;
}

// The Done checkbox (azure-devops-ui) renders role="checkbox" with an
// aria-label carrying the reviewer's display name; these read its state.
function checkbox(name: RegExp): HTMLElement {
  return screen.getByRole("checkbox", { name });
}

describe("App — Phase 2 Done toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes only the reviewer's own row interactive while the round is open", async () => {
    const api = makeApiP2({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone: vi.fn(),
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

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
      const api = makeApiP2({
        getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
        toggleDone: vi.fn(),
      });
      const { unmount } = renderApp(makeSdk(viewer), api, makeAdo(AUTHOR_ID));

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
    const closed = makeRound({
      status: "closed",
      closedAt: "2026-07-25T02:00:00.000Z",
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
      ],
    });
    const api = makeApiP2({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

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
    const api = makeApiP2({ getCurrentRound, toggleDone });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

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
    const closed = makeRound({
      status: "closed",
      closedAt: "2026-07-25T02:00:00.000Z",
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
      ],
    });
    const toggleDone = vi.fn();
    const api = makeApiP2({
      getCurrentRound: vi.fn().mockResolvedValue(closed),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

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
      const healed = makeRound({
        status: "closed",
        closedAt: "2026-07-25T02:00:00.000Z",
        reviewers: [
          makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
          makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
        ],
      });
      const getCurrentRound = vi
        .fn()
        .mockResolvedValueOnce(open) // initial load
        .mockResolvedValueOnce(healed); // drift re-fetch
      const toggleDone = vi
        .fn()
        .mockRejectedValue(new ApiError(status, code));
      const api = makeApiP2({ getCurrentRound, toggleDone });
      renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAdo(AUTHOR_ID));

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

// A live ADO reviewer as the `ado` GitClient seam yields it — the shape
// that maps to Feature 1's IncomingReviewer (adoId/email/displayName/
// isRequired/isContainer). Containers and the author are dropped SERVER-
// side (snapshotReviewers), so the panel sends the raw list unfiltered.
interface AdoReviewerLite {
  adoId: string;
  displayName: string;
  email: string;
  isRequired: boolean;
  isContainer: boolean;
}

function adoReviewer(
  adoId: string,
  displayName: string,
  opts: { isRequired?: boolean; isContainer?: boolean } = {}
): AdoReviewerLite {
  return {
    adoId,
    displayName,
    email: `${displayName.toLowerCase().replace(/\s+/g, "")}@example.com`,
    isRequired: opts.isRequired ?? true,
    isContainer: opts.isContainer ?? false,
  };
}

// An `ado` fake whose getPullRequest yields a full live PR — createdBy
// identity (id + name + email, the author's display/Teams data the
// openRound body carries) plus the reviewer snapshot, title, and url.
function makeAdoP3(opts: {
  createdByAdoId: string;
  reviewers: AdoReviewerLite[];
  title?: string;
  url?: string;
  createdByName?: string;
  createdByEmail?: string;
}): AdoClient {
  return {
    getPullRequest: vi.fn().mockResolvedValue({
      createdByAdoId: opts.createdByAdoId,
      createdByName: opts.createdByName ?? "The Author",
      createdByEmail: opts.createdByEmail ?? "author@example.com",
      reviewers: opts.reviewers,
      title: opts.title ?? "Add the widget",
      url: opts.url ?? "https://example.com/pr/42",
    }),
  } as unknown as AdoClient;
}

function makeApiP3(opts: {
  getCurrentRound: ApiClient["getCurrentRound"];
  openRound: (
    prKey: string,
    request: {
      phase: Round["phase"];
      reviewers: AdoReviewerLite[];
      prTitle: string;
      prUrl: string;
      author: { name: string; email: string };
      label?: string;
    }
  ) => Promise<Round>;
}): ApiClient {
  return opts as unknown as ApiClient;
}

function readyButton(): HTMLElement {
  return screen.getByRole("button", { name: /ready for review/i });
}

describe("App — Phase 3 Ready for review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the author the compose form (phase toggle + Ready) on a 204", async () => {
    const openRound = vi.fn();
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null), // 204 → no round
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID, // viewer created the PR
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
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
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound: vi.fn(),
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID, // PR created by someone else
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(STRANGER_ID), api, ado);

    expect(await screen.findByText(/no round yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ready for review/i })
    ).not.toBeInTheDocument();
  });

  it("shows no Ready for review button to the author while a round is open", async () => {
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()), // open round
      openRound: vi.fn(),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    }));

    // The open round renders; a second round can't be opened concurrently.
    expect(
      await screen.findByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ready for review/i })
    ).not.toBeInTheDocument();
  });

  it("reads ADO live at the click, THEN calls openRound with that snapshot", async () => {
    const openRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    const rev = adoReviewer(REVIEWER_ONE_ID, "Rev One");
    const ado = makeAdoP3({ createdByAdoId: AUTHOR_ID, reviewers: [rev] });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(await screen.findByRole("button", {
      name: /ready for review/i,
    }));

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));

    // The click read ADO afresh (in addition to the compose-gate read),
    // and openRound got the live reviewers + title + url + author.
    expect(ado.getPullRequest).toHaveBeenCalledTimes(2);
    expect(openRound).toHaveBeenCalledWith(
      PR_KEY,
      expect.objectContaining({
        phase: "spec",
        reviewers: [rev],
        prTitle: "Add the widget",
        prUrl: "https://example.com/pr/42",
        author: { name: "The Author", email: "author@example.com" },
      })
    );

    // Sequencing: the fresh ADO read precedes the openRound call.
    const lastAdoRead = (ado.getPullRequest as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder.at(-1) as number;
    const openCall = openRound.mock.invocationCallOrder[0];
    expect(lastAdoRead).toBeLessThan(openCall);
  });

  it("omits the label when the author leaves it untouched", async () => {
    const openRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(await screen.findByRole("button", {
      name: /ready for review/i,
    }));

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    // Untouched → label omitted so the API generates it canonically.
    expect(openRound.mock.calls[0][1].label).toBeUndefined();
  });

  it("sends the exact label text when the author edits it", async () => {
    const openRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    await screen.findByRole("button", { name: /ready for review/i });
    const label = screen.getByRole("textbox");
    fireEvent.change(label, { target: { value: "Round 1 — Please look" } });

    fireEvent.click(readyButton());

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(openRound.mock.calls[0][1].label).toBe("Round 1 — Please look");
  });

  it("defaults the phase to spec on a 204 (no previous round)", async () => {
    const openRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(await screen.findByRole("button", {
      name: /ready for review/i,
    }));

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(openRound.mock.calls[0][1].phase).toBe("spec");
  });

  it("defaults the phase to the previous round's phase on a closed round", async () => {
    // The author views a terminal (closed) round → compose the NEXT round.
    const closed = makeRound({
      roundNumber: 2,
      phase: "implementation",
      status: "closed",
      closedAt: "2026-07-25T02:00:00.000Z",
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
      ],
    });
    const openRound = vi.fn().mockResolvedValue(makeRound({ roundNumber: 3 }));
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(closed),
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    // The compose form replaces the read-only closed view for the author,
    // and reads ADO once up front to gate the button.
    fireEvent.click(await screen.findByRole("button", {
      name: /ready for review/i,
    }));

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(openRound.mock.calls[0][1].phase).toBe("implementation");
  });

  it("flips the phase sent when the author toggles to Implementation Review", async () => {
    const openRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null), // 204 → default spec
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    await screen.findByRole("button", { name: /ready for review/i });
    fireEvent.click(
      screen.getByRole("button", { name: /implementation review/i })
    );
    fireEvent.click(readyButton());

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(openRound.mock.calls[0][1].phase).toBe("implementation");
  });

  it("disables Ready with a hint when the snapshot has zero eligible reviewers", async () => {
    const openRound = vi.fn();
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    // Only a container (team) and the author himself — no eligible individual.
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [
        adoReviewer("team-guid", "The Team", { isContainer: true }),
        adoReviewer(AUTHOR_ID, "The Author"),
      ],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    const ready = await screen.findByRole("button", {
      name: /ready for review/i,
    });
    expect(ready).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/eligible reviewer/i)).toBeInTheDocument();

    // A disabled primary action can never fire the open call.
    fireEvent.click(ready);
    expect(openRound).not.toHaveBeenCalled();
  });

  it("maps a 422 INSUFFICIENT_REVIEWERS to an inline validation message", async () => {
    const openRound = vi
      .fn()
      .mockRejectedValue(new ApiError(422, "INSUFFICIENT_REVIEWERS"));
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    // Client pre-check passes (one eligible reviewer), so the button is
    // enabled — the server's 422 is the authoritative backstop.
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(await screen.findByRole("button", {
      name: /ready for review/i,
    }));

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/eligible reviewer/i)
    ).toBeInTheDocument();
  });

  it("reconciles to the returned open round after a successful openRound", async () => {
    const opened = makeRound(); // open, "1 of 2 reviewed"
    const openRound = vi.fn().mockResolvedValue(opened);
    const api = makeApiP3({
      getCurrentRound: vi.fn().mockResolvedValue(null),
      openRound,
    });
    const ado = makeAdoP3({
      createdByAdoId: AUTHOR_ID,
      reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
    });
    renderApp(makeSdk(AUTHOR_ID), api, ado);

    fireEvent.click(await screen.findByRole("button", {
      name: /ready for review/i,
    }));

    // The returned Round replaces panel state — the new open round renders.
    expect(
      await screen.findByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 reviewed/i)).toBeInTheDocument();
  });
});

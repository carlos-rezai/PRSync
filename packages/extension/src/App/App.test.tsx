/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-type-assertion --
   Every finding under these four rules in this file comes from one cause:
   the partial client fakes below, and the type assertions that let them
   stand in for complete interfaces. Group 1 of issue #14 replaces them
   with a shared typed fixture module whose fakes implement their
   interfaces fully, which deletes the findings rather than papering over
   them — so fixing them here would be fixing them twice. This suppression
   is removed in the commit that repoints this file at the fixtures. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
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
  // Cast because Phase 6 (issue #13) adds `resize` to the seam — the host's
  // "size the frame to my content" call. Drop the cast once `SdkClient`
  // declares it.
  return {
    getUser: () => ({ id: viewerAdoId, displayName: "Viewer" }),
    prKeyParts: () => ({
      projectId: PROJECT_ID,
      repositoryId: REPO_ID,
      pullRequestId: 42,
    }),
    getAccessToken: vi.fn().mockResolvedValue("fake-token"),
    resize: vi.fn(),
  } as SdkClient;
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
      const toggleDone = vi.fn().mockRejectedValue(new ApiError(status, code));
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
    renderApp(
      makeSdk(AUTHOR_ID),
      api,
      makeAdoP3({
        createdByAdoId: AUTHOR_ID,
        reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
      })
    );

    // The open round renders (for the author the label is the Phase 4
    // edit field); a second round can't be opened concurrently.
    expect(
      await screen.findByDisplayValue("Round 2 — Implementation Review")
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

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
    const lastAdoRead = (
      ado.getPullRequest as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder.at(-1) as number;
    const openCall = openRound.mock.invocationCallOrder[0] as number;
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    // Untouched → label omitted so the API generates it canonically.
    expect(openRound.mock.calls[0]?.[1].label).toBeUndefined();
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
    expect(openRound.mock.calls[0]?.[1].label).toBe("Round 1 — Please look");
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(openRound.mock.calls[0]?.[1].phase).toBe("spec");
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
    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(openRound.mock.calls[0]?.[1].phase).toBe("implementation");
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
    expect(openRound.mock.calls[0]?.[1].phase).toBe("implementation");
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: /ready for review/i,
      })
    );

    await waitFor(() => expect(openRound).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/eligible reviewer/i)).toBeInTheDocument();
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

function makeApiP4(opts: {
  getCurrentRound: ApiClient["getCurrentRound"];
  editLabel?: (
    prKey: string,
    roundNumber: number,
    label: string
  ) => Promise<Round>;
  cancelRound?: (prKey: string, roundNumber: number) => Promise<Round>;
  toggleDone?: (
    prKey: string,
    roundNumber: number,
    done: boolean
  ) => Promise<Round>;
  openRound?: (prKey: string, request: unknown) => Promise<Round>;
}): ApiClient {
  return {
    editLabel: vi.fn(),
    cancelRound: vi.fn(),
    toggleDone: vi.fn(),
    openRound: vi.fn(),
    ...opts,
  } as unknown as ApiClient;
}

// The author's own ADO fake — createdBy is the viewer, and there is one
// eligible reviewer so a post-cancel compose form is not gated off.
function makeAuthorAdo(): AdoClient {
  return makeAdoP3({
    createdByAdoId: AUTHOR_ID,
    reviewers: [adoReviewer(REVIEWER_ONE_ID, "Rev One")],
  });
}

/** Confirms the open "Cancel round?" dialog, scoped so the trigger and
 *  the confirm button (both named "Cancel round") can't be confused. */
function confirmCancel(dialog: HTMLElement): void {
  fireEvent.click(
    within(dialog).getByRole("button", { name: /cancel round/i })
  );
}

describe("App — Phase 4 label edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes the label editable for the author alone on an open round", async () => {
    // Both sides of the gate in one test: the author gets a field holding
    // the stored label; a reviewer and a bystander get read-only text.
    const authorApi = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const authorView = renderApp(
      makeSdk(AUTHOR_ID),
      authorApi,
      makeAuthorAdo()
    );

    expect(await screen.findByRole("textbox")).toHaveValue(
      "Round 2 — Implementation Review"
    );
    authorView.unmount();

    for (const viewer of [REVIEWER_ONE_ID, STRANGER_ID]) {
      const api = makeApiP4({
        getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      });
      const { unmount } = renderApp(makeSdk(viewer), api, makeAuthorAdo());

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
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(
        makeRound({
          status: "cancelled",
          cancelledAt: "2026-07-25T03:00:00.000Z",
        })
      ),
    });
    renderApp(makeSdk(STRANGER_ID), api, makeAuthorAdo());

    expect(
      await screen.findByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits the exact edited text on blur", async () => {
    const editLabel = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

    const field = await screen.findByRole("textbox");
    fireEvent.change(field, { target: { value: "Round 2 — Second pass" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(editLabel).toHaveBeenCalledWith(PR_KEY, 2, "Round 2 — Second pass")
    );
  });

  it("does not call editLabel when the author commits an unchanged label", async () => {
    const editLabel = vi.fn();
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

    // Focusing and leaving the field without typing is not an edit.
    const field = await screen.findByRole("textbox");
    fireEvent.blur(field);
    fireEvent.keyDown(field, { key: "Enter" });

    expect(editLabel).not.toHaveBeenCalled();
  });

  it("replaces panel state with the round editLabel returns", async () => {
    // The API is authoritative on the stored wording.
    const renamed = makeRound({ label: "Round 2 — Stored by the API" });
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      editLabel: vi.fn().mockResolvedValue(renamed),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

    const field = await screen.findByRole("textbox");
    fireEvent.change(field, { target: { value: "Round 2 — My rename" } });
    fireEvent.blur(field);

    expect(
      await screen.findByDisplayValue("Round 2 — Stored by the API")
    ).toBeInTheDocument();
  });

  it("shows an inline message and leaves the round intact when the edit fails", async () => {
    const getCurrentRound = vi.fn().mockResolvedValue(makeRound());
    const api = makeApiP4({
      getCurrentRound,
      editLabel: vi.fn().mockRejectedValue(new ApiError(500, null)),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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
        .mockResolvedValueOnce(makeRound()) // initial load
        .mockResolvedValue(healed); // drift re-fetch
      const api = makeApiP4({
        getCurrentRound,
        editLabel: vi.fn().mockRejectedValue(new ApiError(status, code)),
      });
      renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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
    const authorApi = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const authorView = renderApp(
      makeSdk(AUTHOR_ID),
      authorApi,
      makeAuthorAdo()
    );

    expect(
      await screen.findByRole("button", { name: /cancel round/i })
    ).toBeInTheDocument();
    authorView.unmount();

    for (const viewer of [REVIEWER_ONE_ID, STRANGER_ID]) {
      const api = makeApiP4({
        getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      });
      const { unmount } = renderApp(makeSdk(viewer), api, makeAuthorAdo());

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
    const api = makeApiP4({
      getCurrentRound: vi
        .fn()
        .mockResolvedValue(
          makeRound({ status: "closed", closedAt: "2026-07-25T02:00:00.000Z" })
        ),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

    await screen.findByRole("button", { name: /ready for review/i });
    expect(
      screen.queryByRole("button", { name: /cancel round/i })
    ).not.toBeInTheDocument();
  });

  it("opens a confirmation dialog without cancelling anything", async () => {
    const cancelRound = vi.fn();
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      cancelRound,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );

    // A silent abandonment is never one misclick away.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(cancelRound).not.toHaveBeenCalled();
  });

  it("dismisses the confirmation without cancelling", async () => {
    const cancelRound = vi.fn();
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      cancelRound,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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
    const cancelled = makeRound({
      status: "cancelled",
      cancelledAt: "2026-07-25T03:00:00.000Z",
    });
    const cancelRound = vi.fn().mockResolvedValue(cancelled);
    const toggleDone = vi.fn();
    const openRound = vi.fn();
    const api = makeApiP4({
      getCurrentRound: vi
        .fn()
        .mockResolvedValueOnce(makeRound())
        .mockResolvedValue(cancelled),
      cancelRound,
      toggleDone,
      openRound,
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    confirmCancel(await screen.findByRole("dialog"));

    await waitFor(() => expect(cancelRound).toHaveBeenCalledWith(PR_KEY, 2));
    // Cancel is a silent abandonment: it routes through the cancel
    // endpoint alone, never a close-producing call.
    expect(toggleDone).not.toHaveBeenCalled();
    expect(openRound).not.toHaveBeenCalled();
  });

  it("reflects the cancelled round and offers the author round N+1", async () => {
    const cancelled = makeRound({
      status: "cancelled",
      cancelledAt: "2026-07-25T03:00:00.000Z",
    });
    const api = makeApiP4({
      getCurrentRound: vi
        .fn()
        .mockResolvedValueOnce(makeRound()) // open, before the cancel
        .mockResolvedValue(cancelled), // terminal, after it
      cancelRound: vi.fn().mockResolvedValue(cancelled),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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
    const api = makeApiP4({
      getCurrentRound,
      cancelRound: vi.fn().mockRejectedValue(new ApiError(500, null)),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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
      .mockResolvedValueOnce(makeRound())
      .mockResolvedValue(healed);
    const api = makeApiP4({
      getCurrentRound,
      cancelRound: vi
        .fn()
        .mockRejectedValue(new ApiError(409, "ROUND_NOT_OPEN")),
    });
    renderApp(makeSdk(AUTHOR_ID), api, makeAuthorAdo());

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

// --- Phase 5: Polling + refresh banner --------------------------------
//
// Review is live team activity, so the round a viewer is staring at goes
// stale under them. A ~20s poll re-reads the current round and compares a
// client `roundFingerprint` against the viewer's BASELINE — the last state
// they saw or acted on. A mismatch is Drift and raises a refresh banner the
// viewer must CLICK; the panel never silently live-patches state under a
// cursor. The viewer's own mutations reset the baseline, so their own
// changes can never raise the banner at them.
//
// Polling pauses on two conditions: while a mutation of the viewer's is in
// flight (a poll must not clobber an optimistic flip) and while the tab is
// hidden (a backgrounded panel wastes requests).
//
// This slice also completes the error surface: a `503 CONCURRENCY_EXHAUSTED`
// is auto-retried EXACTLY once before the viewer is told to try again, and a
// `401` says the session expired.
//
// These tests run on fake timers where they advance the poll, and assert
// only through rendered output and the injected `api` fake — never internal
// state. Issue #12 / PRD #7 Phase 5. Terminology:
// docs/ubiquitous-language.md.

const POLL_MS = 20_000;

/** Lets pending promise chains settle and their React updates land. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
  });
}

/** Advances whole poll intervals, then settles what they kicked off. */
async function tickPoll(intervals = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * intervals);
  });
  await flush();
}

/** Drives the Page Visibility API the way a real tab switch would. */
function setTabVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: state === "hidden",
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The refresh banner's action, or `null` while the panel is in sync. */
function refreshBanner(): HTMLElement | null {
  return screen.queryByRole("button", { name: /refresh/i });
}

/** A round closed by quorum — the state a second Done lands the panel in. */
function closedRound(): Round {
  return makeRound({
    status: "closed",
    closedAt: "2026-07-25T02:00:00.000Z",
    reviewers: [
      makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
      makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
    ],
  });
}

describe("App — Phase 5 polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setTabVisibility("visible");
  });

  it("re-reads the current round every ~20 seconds", async () => {
    const getCurrentRound = vi.fn().mockImplementation(async () => makeRound());
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound }),
      makeAuthorAdo()
    );
    await flush();

    expect(getCurrentRound).toHaveBeenCalledTimes(1);
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(2);
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(3);
  });

  it("stops polling while the tab is hidden and resumes when it returns", async () => {
    const getCurrentRound = vi.fn().mockImplementation(async () => makeRound());
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound }),
      makeAuthorAdo()
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
    const getCurrentRound = vi.fn().mockImplementation(async () => makeRound());
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound, toggleDone }),
      makeAuthorAdo()
    );
    await flush();

    fireEvent.click(checkbox(/Rev One/i));
    await tickPoll(2);
    expect(getCurrentRound).toHaveBeenCalledTimes(1);

    // Once the PATCH settles, polling picks up again.
    resolveToggle(closedRound());
    await flush();
    await tickPoll();
    expect(getCurrentRound).toHaveBeenCalledTimes(2);
  });
});

describe("App — Phase 5 drift + refresh banner", () => {
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
    const getCurrentRound = vi.fn().mockImplementation(async () => makeRound());
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound }),
      makeAuthorAdo()
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
      .mockImplementationOnce(async () => makeRound())
      .mockImplementation(async () => drifted);
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound }),
      makeAuthorAdo()
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
      .mockImplementationOnce(async () => makeRound())
      .mockImplementation(async () => drifted);
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound }),
      makeAuthorAdo()
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
      .mockImplementationOnce(async () => makeRound())
      .mockImplementation(async () => drifted);
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound }),
      makeAuthorAdo()
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
    const closed = closedRound();
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(async () => makeRound())
      .mockImplementation(async () => closed);
    const toggleDone = vi.fn().mockImplementation(async () => closed);
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound, toggleDone }),
      makeAuthorAdo()
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
    const healed = closedRound();
    const getCurrentRound = vi
      .fn()
      .mockImplementationOnce(async () => makeRound())
      .mockImplementation(async () => healed);
    const toggleDone = vi
      .fn()
      .mockRejectedValue(new ApiError(409, "ROUND_NOT_OPEN"));
    renderApp(
      makeSdk(REVIEWER_ONE_ID),
      makeApiP4({ getCurrentRound, toggleDone }),
      makeAuthorAdo()
    );
    await flush();

    fireEvent.click(checkbox(/Rev One/i));
    await flush();
    expect(screen.getByText(/all reviewed/i)).toBeInTheDocument();

    await tickPoll(2);
    expect(refreshBanner()).toBeNull();
  });
});

describe("App — Phase 5 error surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-retries a 503 once and surfaces nothing when the retry succeeds", async () => {
    const closed = closedRound();
    const toggleDone = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, "CONCURRENCY_EXHAUSTED"))
      .mockResolvedValue(closed);
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAuthorAdo());

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
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAuthorAdo());

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
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
      toggleDone,
    });
    renderApp(makeSdk(REVIEWER_ONE_ID), api, makeAuthorAdo());

    fireEvent.click(await screen.findByRole("checkbox", { name: /Rev One/i }));

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(toggleDone).toHaveBeenCalledTimes(1);
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

/** The seam's "size me to my content" spy on an injected `sdk` fake. */
function resizeSpy(sdk: SdkClient): ReturnType<typeof vi.fn> {
  return (sdk as unknown as { resize: ReturnType<typeof vi.fn> }).resize;
}

describe("App — Phase 6 autosize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sizes the frame to its content once the round renders", async () => {
    const sdk = makeSdk(REVIEWER_ONE_ID);
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    renderApp(sdk, api, makeAuthorAdo());

    // The spinner and the settled round are different heights, so the host
    // has to be told once the real content is on screen.
    await screen.findByText("Rev One");
    await waitFor(() => expect(resizeSpy(sdk)).toHaveBeenCalled());
  });

  it("re-sizes when a mutation swaps the view under the viewer", async () => {
    const cancelled = makeRound({
      status: "cancelled",
      cancelledAt: "2026-07-25T03:00:00.000Z",
    });
    const sdk = makeSdk(AUTHOR_ID);
    const api = makeApiP4({
      getCurrentRound: vi
        .fn()
        .mockResolvedValueOnce(makeRound())
        .mockResolvedValue(cancelled),
      cancelRound: vi.fn().mockResolvedValue(cancelled),
    });
    renderApp(sdk, api, makeAuthorAdo());

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel round/i })
    );
    await waitFor(() => expect(resizeSpy(sdk)).toHaveBeenCalled());
    const sizedForTheRound = resizeSpy(sdk).mock.calls.length;

    confirmCancel(await screen.findByRole("dialog"));

    // The reviewer list gives way to the compose form — a different height
    // the host cannot discover for itself.
    await screen.findByRole("button", { name: /ready for review/i });
    await waitFor(() =>
      expect(resizeSpy(sdk).mock.calls.length).toBeGreaterThan(sizedForTheRound)
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
    const api = makeApiP4({
      getCurrentRound: vi
        .fn()
        .mockImplementationOnce(async () => makeRound())
        .mockImplementation(async () => drifted),
    });
    renderApp(sdk, api, makeAuthorAdo());
    await flush();

    const sizedForTheRound = resizeSpy(sdk).mock.calls.length;
    await tickPoll();

    // The banner is a whole extra row appearing below the panel; without a
    // re-measure the host frame clips it, which is precisely the row the
    // viewer has to click.
    expect(refreshBanner()).not.toBeNull();
    expect(resizeSpy(sdk).mock.calls.length).toBeGreaterThan(sizedForTheRound);
  });
});

describe("App — Phase 6 theming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hardcodes no colour of its own, so the host's theme governs the panel", async () => {
    const sdk = makeSdk(REVIEWER_ONE_ID);
    const api = makeApiP4({
      getCurrentRound: vi.fn().mockResolvedValue(makeRound()),
    });
    const { container } = renderApp(sdk, api, makeAuthorAdo());
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

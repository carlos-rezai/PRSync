import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import type { SdkClient } from "../sdk";
import type { ApiClient } from "../api";
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

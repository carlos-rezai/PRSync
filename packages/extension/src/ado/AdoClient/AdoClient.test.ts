import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAdoClient } from "./AdoClient";
import { PR_KEY_PARTS } from "../../test/fixtures/fixtures";

// The one place in this package where `vi.mock` is used, and deliberately
// so: everywhere else the DI seam exists precisely to avoid mocking a
// module (design log 02, Q14), but here the module boundary IS the thing
// under test. `createAdoClient` reaches for ADO's own `GitRestClient`, and
// what it owes is a faithful mapping of `IdentityRefWithVote` onto
// `AdoReviewer` — which cannot be asserted without standing in for that
// client. This is not a violation of the seam decision; it is the one case
// the seam does not cover.
//
// The mapping matters because the round-open snapshot is built from it:
// `isContainer` and `isRequired` decide which reviewers gate a round, and
// `uniqueName` is the email Feature 3 resolves to a Teams identity. A
// silently renamed field here would produce a round with the wrong gating
// set and no error anywhere.

/** The slice of ADO's `GitPullRequest` that `createAdoClient` reads. */
interface GitPullRequestSlice {
  createdBy: { id: string; displayName: string; uniqueName: string };
  reviewers: Array<{
    id: string;
    displayName: string;
    uniqueName: string;
    isRequired: boolean;
    isContainer: boolean;
  }>;
  title: string;
  url: string;
}

const { getPullRequestById, getClient, GitRestClient } = vi.hoisted(() => ({
  getPullRequestById:
    vi.fn<(id: number, project: string) => Promise<GitPullRequestSlice>>(),
  getClient: vi.fn(),
  // `azure-devops-extension-api/Git` ships as an AMD bundle that has no
  // loader under Vitest, so the class is stood in for as well. It is only
  // ever used as the token handed to `getClient`, which is exactly what
  // the first test asserts.
  GitRestClient: class GitRestClient {},
}));

vi.mock("azure-devops-extension-api/Common", () => ({
  getClient: getClient.mockImplementation(() => ({ getPullRequestById })),
}));

vi.mock("azure-devops-extension-api/Git", () => ({ GitRestClient }));

function livePullRequest(
  overrides: Partial<GitPullRequestSlice> = {}
): GitPullRequestSlice {
  return {
    createdBy: {
      id: "author-guid",
      displayName: "The Author",
      uniqueName: "author@example.com",
    },
    reviewers: [],
    title: "Add the widget",
    url: "https://dev.azure.com/org/_apis/git/pullRequests/42",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdoClient.getPullRequest", () => {
  it("fetches the PR by id and project through the typed GitRestClient", async () => {
    getPullRequestById.mockResolvedValue(livePullRequest());

    await createAdoClient().getPullRequest(PR_KEY_PARTS);

    // ADO's own typed client, never a hand-rolled fetch — the panel does
    // not construct requests against someone else's API.
    expect(getClient).toHaveBeenCalledWith(GitRestClient);
    // The repository id is deliberately absent: ADO's PR ids are unique
    // per project, and this is ADO's own API, not PRSync's PR key.
    expect(getPullRequestById).toHaveBeenCalledWith(
      PR_KEY_PARTS.pullRequestId,
      PR_KEY_PARTS.projectId
    );
  });

  it("maps createdBy onto the author fields the openRound body carries", async () => {
    getPullRequestById.mockResolvedValue(
      livePullRequest({
        createdBy: {
          id: "author-guid",
          displayName: "The Author",
          uniqueName: "author@example.com",
        },
        title: "Add the widget",
        url: "https://dev.azure.com/org/_apis/git/pullRequests/42",
      })
    );

    const pr = await createAdoClient().getPullRequest(PR_KEY_PARTS);

    expect(pr).toMatchObject({
      createdByAdoId: "author-guid",
      createdByName: "The Author",
      // ADO's `uniqueName` IS the email; nothing else on the identity is.
      createdByEmail: "author@example.com",
      title: "Add the widget",
      url: "https://dev.azure.com/org/_apis/git/pullRequests/42",
    });
  });

  it("maps each IdentityRefWithVote onto an AdoReviewer", async () => {
    getPullRequestById.mockResolvedValue(
      livePullRequest({
        reviewers: [
          {
            id: "reviewer-guid",
            displayName: "Rev One",
            uniqueName: "revone@example.com",
            isRequired: true,
            isContainer: false,
          },
          {
            id: "team-guid",
            displayName: "The Team",
            uniqueName: "team@example.com",
            isRequired: false,
            isContainer: true,
          },
        ],
      })
    );

    const pr = await createAdoClient().getPullRequest(PR_KEY_PARTS);

    // Both flags survive unchanged, and the list is NOT filtered here —
    // containers and the author are dropped server-side, so the panel
    // sends ADO's list exactly as ADO gave it.
    expect(pr.reviewers).toEqual([
      {
        adoId: "reviewer-guid",
        displayName: "Rev One",
        email: "revone@example.com",
        isRequired: true,
        isContainer: false,
      },
      {
        adoId: "team-guid",
        displayName: "The Team",
        email: "team@example.com",
        isRequired: false,
        isContainer: true,
      },
    ]);
  });

  it("yields an empty reviewer list when the PR has none", async () => {
    getPullRequestById.mockResolvedValue(livePullRequest({ reviewers: [] }));

    const pr = await createAdoClient().getPullRequest(PR_KEY_PARTS);

    expect(pr.reviewers).toEqual([]);
  });
});

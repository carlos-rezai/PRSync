import { getClient } from "azure-devops-extension-api/Common";
import { GitRestClient } from "azure-devops-extension-api/Git";
import type { PrKeyParts } from "../../lib";

// The `ado/` layer: reads Azure DevOps's OWN PR REST API via the typed
// `GitRestClient` (never a hand-rolled fetch). In Phase 1 it is consulted
// at exactly one moment — a `204` (no round), to read the PR's
// `createdBy` and decide author vs. bystander. Later phases reuse it for
// the "Ready for review" reviewer snapshot.

/** A live ADO reviewer, mapped from `IdentityRefWithVote`. */
export interface AdoReviewer {
  adoId: string;
  displayName: string;
  email: string;
  isRequired: boolean;
  isContainer: boolean;
}

/** The slice of ADO's live PR the panel cares about. */
export interface AdoPullRequest {
  createdByAdoId: string;
  reviewers: AdoReviewer[];
  title: string;
  url: string;
}

export interface AdoClient {
  getPullRequest(parts: PrKeyParts): Promise<AdoPullRequest>;
}

/** Constructs the real `GitRestClient`-backed ADO client. */
export function createAdoClient(): AdoClient {
  return {
    async getPullRequest(parts) {
      const git = getClient(GitRestClient);
      const pr = await git.getPullRequestById(
        parts.pullRequestId,
        parts.projectId
      );
      return {
        createdByAdoId: pr.createdBy.id,
        title: pr.title,
        url: pr.url,
        reviewers: pr.reviewers.map((reviewer) => ({
          adoId: reviewer.id,
          displayName: reviewer.displayName,
          email: reviewer.uniqueName,
          isRequired: reviewer.isRequired,
          isContainer: reviewer.isContainer,
        })),
      };
    },
  };
}

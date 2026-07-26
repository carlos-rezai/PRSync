import { getClient } from "azure-devops-extension-api/Common";
import { GitRestClient } from "azure-devops-extension-api/Git";
import type { PrKeyParts } from "../../lib";

// The `ado/` layer: reads Azure DevOps's OWN PR REST API via the typed
// `GitRestClient` (never a hand-rolled fetch).
//
// The panel consults it as little as possible, and the rule is worth
// stating because the two reads mean different things. At LOAD it is read
// only when a compose form may follow — no round at all, or a terminal
// round the author could follow with the next one — and that read only
// decides what to show. At the "Ready for review" CLICK it is read afresh,
// and that read is the authoritative reviewer snapshot the round is opened
// against. The first is never reused as the second: between them, the
// reviewer list may have moved.

/** A live ADO reviewer, mapped from `IdentityRefWithVote`. */
export interface AdoReviewer {
  adoId: string;
  displayName: string;
  email: string;
  isRequired: boolean;
  isContainer: boolean;
}

/**
 * The slice of ADO's live PR the panel cares about. `createdByName` /
 * `createdByEmail` are inert display/Teams data for the `openRound` body —
 * the API records the author's identity from the caller's token, never
 * from these.
 */
export interface AdoPullRequest {
  createdByAdoId: string;
  createdByName: string;
  createdByEmail: string;
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
        createdByName: pr.createdBy.displayName,
        createdByEmail: pr.createdBy.uniqueName,
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

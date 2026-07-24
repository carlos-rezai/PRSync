import type { IncomingReviewer, RoundReviewer } from "../types/types";

// The reviewer list is copied from ADO at open time and frozen. Only
// real, non-author individuals are tracked: containers (teams/groups)
// and the author are dropped at snapshot time. Each survivor starts
// `done: false` with the reserved `teamsIdOverride` nulled out.

export function snapshotReviewers(
  incoming: IncomingReviewer[],
  authorAdoId: string
): RoundReviewer[] {
  return incoming
    .filter(
      (reviewer) => !reviewer.isContainer && reviewer.adoId !== authorAdoId
    )
    .map((reviewer) => ({
      adoId: reviewer.adoId,
      email: reviewer.email,
      displayName: reviewer.displayName,
      isRequired: reviewer.isRequired,
      done: false,
      teamsIdOverride: null,
    }));
}

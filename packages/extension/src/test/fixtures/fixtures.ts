import type { Round, RoundReviewer } from "../../lib";
import type { AdoPullRequest, AdoReviewer } from "../../ado";

// Domain builders shared by every test in the package: the identities a
// panel test casts, and one builder per entity the panel reads.
//
// Each builder returns a complete, valid value and takes an overrides
// object, so a test spells out only the field its behaviour turns on and
// the rest reads as "and everything else is ordinary". They are typed
// against the real `Round` / `RoundReviewer` / `AdoReviewer` /
// `AdoPullRequest` — no partial shapes, no assertions — so a change to
// any of those types is a compile error here rather than a puzzling
// runtime failure spread across the suite.
//
// Lives under `src/test/` rather than in a module folder because
// component, client and container tests all consume it; putting it inside
// any one module would force imports upward and across layers. The
// directory already sits outside the layer conventions (it holds the
// Vitest setup and the packaging contract tests) and has no barrel.
//
// Terminology: docs/ubiquitous-language.md.

export const PROJECT_ID = "6f5e4d3c-2b1a-0908-1716-2524232221f0";
export const REPO_ID = "aabbccdd-eeff-0011-2233-445566778899";
export const PULL_REQUEST_ID = 42;

/**
 * The canonical PR key the panel builds from the contribution context —
 * the exact `{guid}:{guid}:{int}` string every mutating call must carry.
 * Written out literally rather than through `buildPrKey`, so a test that
 * asserts on it is not checking the code under test against itself.
 */
export const PR_KEY = `${PROJECT_ID}:${REPO_ID}:${PULL_REQUEST_ID}`;

export const PR_KEY_PARTS = {
  projectId: PROJECT_ID,
  repositoryId: REPO_ID,
  pullRequestId: PULL_REQUEST_ID,
};

export const AUTHOR_ID = "author-guid-0000-0000-0000-000000000001";
export const REVIEWER_ONE_ID = "reviewer1-guid-0000-0000-0000-0000000002";
export const REVIEWER_TWO_ID = "reviewer2-guid-0000-0000-0000-0000000003";
/** A viewer who is neither the author nor a tracked reviewer. */
export const STRANGER_ID = "stranger-guid-0000-0000-0000-000000000004";

export const OPENED_AT = "2026-07-25T00:00:00.000Z";
export const DONE_AT = "2026-07-25T01:00:00.000Z";
export const CLOSED_AT = "2026-07-25T02:00:00.000Z";
export const CANCELLED_AT = "2026-07-25T03:00:00.000Z";

export const PR_TITLE = "Add the widget";
export const PR_URL = "https://example.com/pr/42";
export const AUTHOR_NAME = "The Author";
export const AUTHOR_EMAIL = "author@example.com";

/** The convention the builders follow so a persona's email is derivable. */
function emailFor(displayName: string): string {
  return `${displayName.toLowerCase().replace(/\s+/g, "")}@example.com`;
}

/**
 * A reviewer frozen into a round's snapshot. `email` follows from
 * `displayName` and `doneAt` follows from `done`, so the two fields a test
 * usually cares about carry the rest with them.
 */
export function makeReviewer(
  overrides: Partial<RoundReviewer> = {}
): RoundReviewer {
  const displayName = overrides.displayName ?? "Rev One";
  const done = overrides.done ?? false;
  return {
    adoId: REVIEWER_ONE_ID,
    email: emailFor(displayName),
    displayName,
    isRequired: true,
    done,
    doneAt: done ? DONE_AT : undefined,
    teamsIdOverride: null,
    ...overrides,
  };
}

/**
 * An open round 2 with two snapshotted reviewers, one of them done — the
 * "1 of 2 reviewed" state most panel tests start from.
 */
export function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    prKey: PR_KEY,
    roundNumber: 2,
    phase: "implementation",
    label: "Round 2 — Implementation Review",
    status: "open",
    quorum: 2,
    reviewers: [
      makeReviewer({ adoId: REVIEWER_ONE_ID, displayName: "Rev One" }),
      makeReviewer({
        adoId: REVIEWER_TWO_ID,
        displayName: "Rev Two",
        done: true,
      }),
    ],
    prTitle: PR_TITLE,
    prUrl: PR_URL,
    authorAdoId: AUTHOR_ID,
    authorName: AUTHOR_NAME,
    authorEmail: AUTHOR_EMAIL,
    openedAt: OPENED_AT,
    schemaVersion: 1,
    ...overrides,
  };
}

/**
 * The same round after quorum was met: `closed`, with every reviewer done.
 * This is the state a second Done signal lands the panel in, and the state
 * a drift-heal re-fetch typically discovers, so it is shared rather than
 * rebuilt per test.
 */
export function makeClosedRound(overrides: Partial<Round> = {}): Round {
  return makeRound({
    status: "closed",
    closedAt: CLOSED_AT,
    reviewers: [
      makeReviewer({
        adoId: REVIEWER_ONE_ID,
        displayName: "Rev One",
        done: true,
      }),
      makeReviewer({
        adoId: REVIEWER_TWO_ID,
        displayName: "Rev Two",
        done: true,
      }),
    ],
    ...overrides,
  });
}

/** The same round abandoned by the author: terminal, and silent. */
export function makeCancelledRound(overrides: Partial<Round> = {}): Round {
  return makeRound({
    status: "cancelled",
    cancelledAt: CANCELLED_AT,
    ...overrides,
  });
}

/**
 * A LIVE ADO reviewer, as the `ado` seam yields it — distinct from a
 * `RoundReviewer`, which is the frozen snapshot. Containers and the author
 * are filtered server-side, so the panel sends this list unfiltered.
 */
export function makeAdoReviewer(
  overrides: Partial<AdoReviewer> = {}
): AdoReviewer {
  const displayName = overrides.displayName ?? "Rev One";
  return {
    adoId: REVIEWER_ONE_ID,
    displayName,
    email: emailFor(displayName),
    isRequired: true,
    isContainer: false,
    ...overrides,
  };
}

/**
 * ADO's live PR as the panel reads it. Defaults to a PR the author created
 * with one eligible reviewer, so a compose form built on it is not gated
 * off by `hasEligibleReviewers`.
 */
export function makeAdoPullRequest(
  overrides: Partial<AdoPullRequest> = {}
): AdoPullRequest {
  return {
    createdByAdoId: AUTHOR_ID,
    createdByName: AUTHOR_NAME,
    createdByEmail: AUTHOR_EMAIL,
    reviewers: [
      makeAdoReviewer({ adoId: REVIEWER_ONE_ID, displayName: "Rev One" }),
    ],
    title: PR_TITLE,
    url: PR_URL,
    ...overrides,
  };
}

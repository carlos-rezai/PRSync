// Domain data every layer's tests key off, mirroring
// `packages/extension/src/test/fixtures/fixtures.ts`. Fakes live next
// door in `fakes.ts`; this file holds only real domain values.
//
// Like the extension's, these sit outside the layer conventions
// deliberately: functions/, services/ and storage/ tests all consume
// them, so putting them inside any one layer would force imports upward
// and across layers.

/**
 * A well-formed PR key — `{projectId}:{repositoryId}:{pullRequestId}`.
 * Shared so that a test asserting "the handler correlated on the PR key"
 * and a test asserting "a malformed key is rejected" disagree about the
 * key for a reason, not by accident.
 */
export const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

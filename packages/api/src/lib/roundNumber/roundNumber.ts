// Round numbers are server-derived so an author can never create a
// duplicate or out-of-order round. The next number is `lastRound + 1`,
// or 1 when the PR has never had a round. The predecessor's status is
// irrelevant here — the caller passes whatever the latest number is.

export function deriveNextRoundNumber(lastRoundNumber: number | null): number {
  return lastRoundNumber === null ? 1 : lastRoundNumber + 1;
}

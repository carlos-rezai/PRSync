/** A stage heading in `docs/setup-guide.md`, capturing its number. */
export const STAGE_HEADING = /^#+\s+Stage\s+(\d+)\b/;

/**
 * The stage numbers `markdown` declares, in the order they appear.
 *
 * Order is preserved rather than sorted, and duplicates are kept, because
 * the caller compares the whole list against the sequence the guide is
 * contracted to carry. Sorting here would turn "stage 7 is written after
 * stage 8" — a real defect in a document whose entire content is
 * sequence — into a pass.
 */
export function stageNumbers(markdown: string): number[] {
  return markdown
    .split("\n")
    .map((line) => line.match(STAGE_HEADING)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number);
}

/**
 * The anchor GitHub generates for a heading, which is what an `#anchor`
 * link has to match.
 *
 * The rules, and the reason a naive lowercase-and-hyphen pass is not good
 * enough: GitHub lowercases, DELETES everything that is not a letter, a
 * digit, a space, an underscore or a hyphen, and only then turns spaces
 * into hyphens. Deleting rather than hyphenating is what makes
 * ``## Why `/api/messages` is anonymous`` slug as `why-apimessages-is-…`,
 * and a link written against the hyphenated guess resolves against
 * nothing while looking correct.
 *
 * The consequence that looks like a bug and is not: an em-dash is deleted
 * and the two spaces around it survive, so every heading in this repo's
 * house style slugs with a DOUBLE hyphen. Tidying runs of hyphens away is
 * wrong for every stage heading in `docs/setup-guide.md` at once.
 */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

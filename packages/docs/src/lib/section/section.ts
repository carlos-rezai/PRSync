import { outsideFences } from "../fences/fences";

/**
 * The body of a section, up to the next same-or-higher heading.
 * `undefined` where no heading matches, so a caller can tell "the section
 * is empty" from "the section is gone" — which are different failures.
 *
 * Fenced blocks are skipped when looking for that boundary: the
 * Environment Variables section is one long fence whose `# packages/api`
 * comments are shell, not markdown, and reading them as headings ends the
 * section before a single setting is seen.
 */
export function section(markdown: string, heading: RegExp): string | undefined {
  const lines = markdown.split("\n");
  const outsideFence = outsideFences(lines);

  const start = lines.findIndex(
    (line, i) => outsideFence[i] && heading.test(line)
  );
  if (start === -1) return undefined;

  const depth = ((lines[start] ?? "").match(/^#+/) ?? ["##"])[0].length;
  const end = lines.findIndex(
    (line, i) =>
      i > start &&
      outsideFence[i] &&
      /^#+\s/.test(line) &&
      (line.match(/^#+/) as RegExpMatchArray)[0].length <= depth
  );

  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

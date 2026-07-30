/**
 * Which of `lines` are outside a fenced code block, one flag per line. A
 * fence line itself counts as inside it: a fence is never content.
 *
 * The leaf every other reader in this workspace stands on, and for the
 * same reason each time — a `#` inside a fence is a shell comment, not a
 * heading, and `docs/deployment.md` carries exactly that shape. Read as
 * headings, those comments invent anchors that render as dead links, end
 * a section before a single setting is seen, and do both while the test
 * that should have caught it goes green.
 */
export function outsideFences(lines: readonly string[]): boolean[] {
  const outside: boolean[] = [];
  let fenced = false;

  for (const line of lines) {
    const isFence = /^\s*```/.test(line);
    outside.push(!fenced && !isFence);
    if (isFence) fenced = !fenced;
  }

  return outside;
}

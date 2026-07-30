/**
 * The shapes every PRSync deployment setting takes. Names are discovered
 * from source rather than listed anywhere on purpose: a hardcoded list is
 * one more thing to forget to update, and would make a test pass by
 * agreeing with itself.
 *
 * Note the `g` flag: use this with `String.prototype.match`, which resets
 * `lastIndex` for you. `.test()` and `.exec()` on a shared global regex
 * resume from wherever the previous caller left off, and two spec files
 * consume this one.
 */
export const SETTING_PATTERN =
  /\b(?:MICROSOFT_APP_[A-Z0-9_]+|AZURE_[A-Z0-9_]*CONNECTION_STRING|PRSYNC_[A-Z0-9_]+|VITE_[A-Z0-9_]+)\b/g;

/** One setting named where it should have been linked. */
export interface TokenHit {
  token: string;
  /** The 1-based line it is written on. */
  line: number;
  /** The line as written, trimmed, so the failure reads like a linter. */
  text: string;
}

/**
 * `line` with every markdown link removed — both the text and the
 * destination.
 *
 * The setup guide is allowed to POINT at a setting; it is not allowed to
 * name one as prose. A link is what a pointer looks like, so stripping
 * links first is what distinguishes "read the bot settings [here]" from a
 * second copy of the settings table.
 */
export function withoutLinks(line: string): string {
  return line
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ") // [text](destination)
    .replace(/<[^>\s]+>/g, " "); // <https://autolink>
}

/**
 * Every PRSync setting token in `markdown` that is not inside a link.
 *
 * Code spans are deliberately NOT exempt: a backticked setting name is
 * the exact shape the duplicated configuration table would take.
 */
export function settingTokens(markdown: string): TokenHit[] {
  const hits: TokenHit[] = [];

  markdown.split("\n").forEach((raw, index) => {
    for (const token of withoutLinks(raw).match(SETTING_PATTERN) ?? []) {
      hits.push({ token, line: index + 1, text: raw.trim() });
    }
  });

  return hits;
}

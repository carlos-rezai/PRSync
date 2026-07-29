// An Adaptive Card `TextBlock` renders limited markdown, and the three
// values PRSync puts in one — the round label, the PR title and the
// author's display name — are all typed by a person. A PR titled
// `[Reset your password](https://evil.example)` becomes a live link in a
// DM whose sender is PRSync itself, which is about as credible as
// phishing gets.

/**
 * The characters a markdown renderer gives meaning to. Punctuation it
 * does not act on — `:` and `/` most of all, which a URL in a PR title
 * is full of — is deliberately absent: escaping it would put visible
 * backslashes into a DM for nothing.
 */
const MARKDOWN_CONTROL = /[\\`*_{}[\]()#+\-.!|~<>&]/g;

/**
 * `text` with every markdown control character backslashed, so a crafted
 * PR title, round label or display name reaches the recipient as the
 * literal text somebody typed rather than as markup.
 *
 * The backslash is escaped by the same pass, which is what stops `\[`
 * from arriving as a bare backslash followed by a live bracket.
 *
 * Applied uniformly to every text-bearing field, `FactSet` values
 * included — nobody should have to remember which fields a renderer
 * treats gently, because none of them are.
 */
export function escapeCardText(text: string): string {
  return text.replace(MARKDOWN_CONTROL, (char) => `\\${char}`);
}

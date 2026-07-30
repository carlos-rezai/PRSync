/**
 * Every `**bolded**` span in `markdown`, in order, without duplicates.
 *
 * A span is read across line breaks and its whitespace collapsed, because
 * a two-word term wrapped by the formatter (`**Round\nclosed**`) renders
 * as one bolded term and must be checked as one. Matching line-by-line
 * instead pairs the wrapped term's closing `**` with the NEXT term's
 * opening one, and reports the prose between them as an unknown term.
 */
export function boldedTerms(markdown: string): string[] {
  const found = markdown.match(/\*\*[^*]+\*\*/g) ?? [];
  return [
    ...new Set(
      found.map((term) => term.slice(2, -2).replace(/\s+/g, " ").trim())
    ),
  ];
}

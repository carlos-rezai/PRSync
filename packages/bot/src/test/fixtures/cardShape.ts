// Queries over a built Adaptive Card, in the same spirit as the
// extension's `panelDom.ts`: the card tests assert what a recipient can
// see — a headline, a set of facts, a button — rather than reaching into
// `body[0].text` by index and breaking the moment an element is added.
//
// It also carries the two numbers and the two character sets that ARE the
// specification, so the reviewer and author card tests cannot quietly
// disagree about them.
//
// Like `fixtures.ts` and `fakes.ts`, this sits outside the layer
// conventions on purpose: `lib/` and `cards/` tests both consume it.

import type {
  AdaptiveCard,
  CardFact,
  CardFactSet,
  CardTextBlock,
} from "../../lib";

/**
 * The cap every text-bearing value is rendered under. A PR title is
 * free text and a round label is author-edited, so either can arrive
 * long enough to push the action button off a phone-sized card.
 */
export const MAX_CARD_FIELD_LENGTH = 200;

/** What a truncated value ends with, so nobody reads a cut title as the whole one. */
export const TRUNCATION_SUFFIX = "…";

/**
 * The characters a markdown renderer gives meaning to. `TextBlock`
 * renders limited markdown, so any of these arriving unescaped in a PR
 * title, round label or author name is an injection into a message sent
 * under PRSync's own name — a link most of all.
 */
export const MARKDOWN_CONTROL_CHARS = "\\`*_{}[]()#+-.!|~<>&";

/**
 * Punctuation no renderer gives meaning to. Escaping it would be pure
 * noise in the DM, so the escape set is asserted from both sides.
 */
export const INERT_PUNCTUATION = ":/,;?@'\"$%^=";

/** The first `TextBlock` — the line a recipient reads before anything else. */
export function headline(card: AdaptiveCard): CardTextBlock {
  const block = card.body.find(
    (element): element is CardTextBlock => element.type === "TextBlock"
  );
  if (block === undefined) {
    throw new Error("the card has no TextBlock to read as a headline");
  }
  return block;
}

/** Every fact across every `FactSet`, in card order. */
export function facts(card: AdaptiveCard): CardFact[] {
  return card.body
    .filter((element): element is CardFactSet => element.type === "FactSet")
    .flatMap((set) => set.facts);
}

/** The value of the fact with `title`, or undefined if the card has no such fact. */
export function factValue(
  card: AdaptiveCard,
  title: string
): string | undefined {
  return facts(card).find((fact) => fact.title === title)?.value;
}

/**
 * Every string a recipient can read: block text, fact titles and values,
 * and action titles. The escaping rule is asserted across all of them at
 * once, deliberately — the whole point of escaping uniformly is that
 * nobody has to remember which fields are safer than others.
 */
export function cardTexts(card: AdaptiveCard): string[] {
  const texts: string[] = [];
  for (const element of card.body) {
    if (element.type === "TextBlock") {
      texts.push(element.text);
    } else {
      for (const fact of element.facts) texts.push(fact.title, fact.value);
    }
  }
  for (const action of card.actions ?? []) texts.push(action.title);
  return texts;
}

/**
 * The control characters in `text` that no backslash protects. A
 * backslash consumes the character after it, so this is what a markdown
 * renderer would still act on.
 */
export function unescapedControlChars(text: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (MARKDOWN_CONTROL_CHARS.includes(char)) found.push(char);
  }
  return found;
}

/** Replaces every `${key}` in every string of a parsed JSON tree. */
function substitute(node: unknown, values: Record<string, string>): unknown {
  if (typeof node === "string") {
    return node.replace(/\$\{(\w+)\}/g, (whole: string, key: string) =>
      key in values ? String(values[key]) : whole
    );
  }
  if (Array.isArray(node)) {
    return node.map((child: unknown) => substitute(child, values));
  }
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const filled: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      filled[key] = substitute(record[key], values);
    }
    return filled;
  }
  return node;
}

/**
 * The frozen handoff template with its `${...}` placeholders filled — the
 * card the builder is required to produce.
 *
 * Substitution runs over the PARSED tree rather than the raw JSON text,
 * so a value containing a quote or a backslash fills a field instead of
 * corrupting the document.
 */
export function fillHandoffTemplate(
  templateJson: string,
  values: Record<string, string>
): AdaptiveCard {
  const template = JSON.parse(templateJson) as unknown;
  return substitute(template, values) as AdaptiveCard;
}

// The pieces both notification cards are made of. They live here rather
// than in either builder because the two cards have to agree about them:
// a rule that only one card applies is a rule a recipient cannot rely
// on, and the difference between the two is meant to be the wording and
// the colour, nothing else.

import { escapeCardText, safeCardUrl, type AdaptiveCard } from "../../lib";

/** The schema both cards declare, matching the frozen handoff design. */
export const CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";

/** The Adaptive Card version Teams renders these under. */
export const CARD_VERSION = "1.5";

/**
 * The cap every text-bearing value is rendered under. A PR title is free
 * text and a round label is author-edited, so either can arrive long
 * enough to push the action button off a phone-sized card.
 */
export const MAX_CARD_FIELD_LENGTH = 200;

/** What a truncated value ends with, so nobody reads a cut title as the whole one. */
export const TRUNCATION_SUFFIX = "…";

/**
 * A person-typed value as it goes onto a card: capped, then escaped.
 *
 * That order matters. Escaping first and cutting after could sever a
 * backslash from the character it protects and hand the renderer a live
 * one at the end of the line.
 */
export function renderCardText(value: string): string {
  return escapeCardText(truncate(value));
}

function truncate(value: string): string {
  if (value.length <= MAX_CARD_FIELD_LENGTH) return value;
  return (
    value.slice(0, MAX_CARD_FIELD_LENGTH - TRUNCATION_SUFFIX.length) +
    TRUNCATION_SUFFIX
  );
}

/**
 * The card's `actions`, to be spread into it — `{ actions: [...] }` for
 * an `https:` URL and `{}` for anything else.
 *
 * An unsafe URL leaves the property absent rather than present and
 * empty: the notification still arrives with all of its information, it
 * simply has no button. A DM that cannot be clicked is a far smaller
 * failure than a `javascript:` button in a message signed PRSync.
 */
export function openPrAction(prUrl: string): Pick<AdaptiveCard, "actions"> {
  const url = safeCardUrl(prUrl);
  if (url === undefined) return {};
  return { actions: [{ type: "Action.OpenUrl", title: "Open PR", url }] };
}

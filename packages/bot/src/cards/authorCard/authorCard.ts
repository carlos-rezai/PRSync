// The card an author sees when their round closes — the "safe to
// proceed" signal this whole product exists to deliver. It is the one
// message that must not be mistaken for the other one: an author who
// reads a round-closed DM as another request to act has been told
// nothing.
//
// `author-notification.json` under `docs/handoff/` is the frozen design,
// kept authoritative by the co-located test for the same reason as the
// reviewer card's — and, like it, named nowhere that ships.

import type { AdaptiveCard, CardContent } from "../../lib";
import {
  CARD_SCHEMA,
  CARD_VERSION,
  openPrAction,
  renderCardText,
} from "../cardParts/cardParts";

/** The round-closed DM for the PR's author. */
export function authorCard(content: CardContent): AdaptiveCard {
  return {
    type: "AdaptiveCard",
    $schema: CARD_SCHEMA,
    version: CARD_VERSION,
    body: [
      {
        type: "TextBlock",
        // Told apart from the reviewer card at a glance, from the same
        // round: a completion, not a request — and the only one of the
        // two that carries a colour.
        text: `${renderCardText(content.roundLabel)} complete — safe to proceed`,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
        color: "Good",
      },
      {
        type: "FactSet",
        // No Author fact: the recipient IS the author, and telling them
        // who wrote their own PR is filler on the one card that has to
        // be read in a glance.
        facts: [{ title: "PR", value: renderCardText(content.prTitle) }],
      },
    ],
    ...openPrAction(content.prUrl),
  };
}

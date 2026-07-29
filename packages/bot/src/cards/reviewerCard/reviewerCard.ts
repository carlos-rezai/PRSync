// The card a reviewer sees when a round opens on a PR they are on. It has
// one job: say which round opened, on which PR, by whom, and get them
// there.
//
// `reviewer-notification.json` under `docs/handoff/` is the frozen design
// of that card, and the co-located test is what keeps it authoritative.
// The handoff lives outside every package, so reading it at runtime would
// mean either a build-time copy that silently drifts or a cross-package
// path that breaks bundling — hence a typed builder, checked against the
// template rather than driven by it. Nothing that ships names that
// directory; `layerPolicy.test.ts` holds the other half of the rule.

import type { AdaptiveCard, CardContent } from "../../lib";
import {
  CARD_SCHEMA,
  CARD_VERSION,
  openPrAction,
  renderCardText,
} from "../cardParts/cardParts";

/** The round-open DM for one snapshotted reviewer. */
export function reviewerCard(content: CardContent): AdaptiveCard {
  return {
    type: "AdaptiveCard",
    $schema: CARD_SCHEMA,
    version: CARD_VERSION,
    body: [
      {
        type: "TextBlock",
        // A reviewer is on several PRs at once and a round is the unit
        // of work being asked for. A DM that names neither is noise.
        text: `${renderCardText(content.roundLabel)} open for review`,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: [
          { title: "PR", value: renderCardText(content.prTitle) },
          { title: "Author", value: renderCardText(content.authorName) },
        ],
      },
    ],
    ...openPrAction(content.prUrl),
  };
}

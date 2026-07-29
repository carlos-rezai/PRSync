import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reviewerCard } from "./reviewerCard";
import {
  MAX_CARD_FIELD_LENGTH,
  TRUNCATION_SUFFIX,
  cardTexts,
  factValue,
  fillHandoffTemplate,
  headline,
  unescapedControlChars,
} from "../../test/fixtures/cardShape";
import {
  CARD_CONTENT,
  HOSTILE_CARD_CONTENT,
  LONG_CARD_CONTENT,
  LONG_CARD_TEXT,
  UNSAFE_CARD_URLS,
} from "../../test/fixtures/fixtures";

// The card a reviewer sees when a round opens on a PR they are on. It has
// one job: say which round opened, on which PR, by whom, and get them
// there.
//
// `docs/handoff/adaptive-cards/reviewer-notification.json` is the frozen
// design of that card, and this file is what keeps it authoritative.
// Reading it here is TEST-ONLY — the handoff lives outside every package,
// so importing it at runtime would mean either a build-time copy that
// silently drifts or a cross-package path that breaks bundling. Hence a
// typed builder, checked against the template rather than driven by it,
// and card drift becomes a red test rather than a surprise in a DM.

const TEMPLATE = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../docs/handoff/adaptive-cards/reviewer-notification.json",
      import.meta.url
    )
  ),
  "utf8"
);

describe("reviewerCard", () => {
  it("is the frozen handoff card with its placeholders filled", () => {
    expect(reviewerCard(CARD_CONTENT)).toEqual(
      fillHandoffTemplate(TEMPLATE, { ...CARD_CONTENT })
    );
  });

  it("names the round, the PR and the author", () => {
    // A reviewer is on several PRs at once and a round is the unit of
    // work being asked for. A DM that names neither is noise.
    const card = reviewerCard(CARD_CONTENT);

    expect(headline(card).text).toContain(CARD_CONTENT.roundLabel);
    expect(factValue(card, "PR")).toBe(CARD_CONTENT.prTitle);
    expect(factValue(card, "Author")).toBe(CARD_CONTENT.authorName);
  });

  it("carries an Open PR action for an https URL", () => {
    // v1 cards are link-out only — this button is the entire path from
    // the DM to the work.
    expect(reviewerCard(CARD_CONTENT).actions).toEqual([
      { type: "Action.OpenUrl", title: "Open PR", url: CARD_CONTENT.prUrl },
    ]);
  });

  it("omits the action entirely for an unsafe URL, leaving the rest intact", () => {
    // The information still arrives; it simply has no button. A
    // notification that cannot be clicked is a far smaller failure than
    // a `javascript:` button in a message signed PRSync.
    const safe = reviewerCard(CARD_CONTENT);

    for (const prUrl of UNSAFE_CARD_URLS) {
      const card = reviewerCard({ ...CARD_CONTENT, prUrl });

      expect(
        card.actions,
        `${JSON.stringify(prUrl)} survived into a clickable action`
      ).toBeUndefined();
      expect(card.body).toEqual(safe.body);
    }
  });

  it("renders markdown control characters as literal text in every field", () => {
    // Uniform across block text AND fact values — the reason the rule is
    // stated as "every text-bearing field" is that nobody should have to
    // remember which ones a renderer treats gently.
    const card = reviewerCard(HOSTILE_CARD_CONTENT);
    const texts = cardTexts(card);

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(
        unescapedControlChars(text),
        `${JSON.stringify(text)} reaches the renderer with live markdown`
      ).toEqual([]);
    }

    // And positively: the crafted link is still readable as what someone
    // typed, not silently stripped.
    expect(headline(card).text).toContain("\\[Click here\\]");
  });

  it("truncates a very long round label, PR title and author name", () => {
    const card = reviewerCard(LONG_CARD_CONTENT);

    for (const title of ["PR", "Author"]) {
      const value = factValue(card, title);
      expect(value, `the card has no ${title} fact`).toBeDefined();
      expect(value).toHaveLength(MAX_CARD_FIELD_LENGTH);
      expect(value?.endsWith(TRUNCATION_SUFFIX)).toBe(true);
      expect(value?.startsWith(LONG_CARD_TEXT.slice(0, 40))).toBe(true);
    }

    // The headline is the truncated label plus a short fixed phrase, so
    // it stays within a card's worth of text rather than the 1,400
    // characters it was handed.
    const text = headline(card).text;
    expect(text).toContain(TRUNCATION_SUFFIX);
    expect(text.length).toBeLessThanOrEqual(MAX_CARD_FIELD_LENGTH + 32);
  });

  it("wraps its headline rather than clipping it", () => {
    expect(headline(reviewerCard(CARD_CONTENT)).wrap).toBe(true);
  });
});

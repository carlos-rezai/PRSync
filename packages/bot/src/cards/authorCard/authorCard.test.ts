import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { authorCard } from "./authorCard";
import { reviewerCard } from "../reviewerCard/reviewerCard";
import {
  MAX_CARD_FIELD_LENGTH,
  TRUNCATION_SUFFIX,
  cardTexts,
  facts,
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

// The card an author sees when their round closes — the "safe to
// proceed" signal this whole product exists to deliver. It is the one
// message that must not be mistaken for the other one: an author who
// reads a round-closed DM as another request to act has been told
// nothing.
//
// `docs/handoff/adaptive-cards/author-notification.json` is the frozen
// design, read here TEST-ONLY for the same reason as the reviewer card's.

const TEMPLATE = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../docs/handoff/adaptive-cards/author-notification.json",
      import.meta.url
    )
  ),
  "utf8"
);

describe("authorCard", () => {
  it("is the frozen handoff card with its placeholders filled", () => {
    expect(authorCard(CARD_CONTENT)).toEqual(
      fillHandoffTemplate(TEMPLATE, { ...CARD_CONTENT })
    );
  });

  it("reads as a completion rather than a request to act", () => {
    // Told apart at a glance, from the same round: different wording,
    // and a colour the reviewer card does not use. Both cards otherwise
    // carry the same round and the same button.
    const author = headline(authorCard(CARD_CONTENT));
    const reviewer = headline(reviewerCard(CARD_CONTENT));

    expect(author.text).not.toBe(reviewer.text);
    expect(author.color).toBeTruthy();
    expect(reviewer.color).toBeUndefined();
  });

  it("names the round and the PR", () => {
    const card = authorCard(CARD_CONTENT);

    expect(headline(card).text).toContain(CARD_CONTENT.roundLabel);
    expect(factValue(card, "PR")).toBe(CARD_CONTENT.prTitle);
  });

  it("does not name the author to the author", () => {
    // The recipient IS the author. Telling them who wrote their own PR
    // is filler on the one card that has to be read in a glance.
    const titles = facts(authorCard(CARD_CONTENT)).map((fact) => fact.title);
    expect(titles).not.toContain("Author");
  });

  it("carries an Open PR action for an https URL", () => {
    expect(authorCard(CARD_CONTENT).actions).toEqual([
      { type: "Action.OpenUrl", title: "Open PR", url: CARD_CONTENT.prUrl },
    ]);
  });

  it("omits the action entirely for an unsafe URL, leaving the rest intact", () => {
    // "Safe to proceed" is the message that must never go missing. It
    // arrives without a button rather than not at all.
    const safe = authorCard(CARD_CONTENT);

    for (const prUrl of UNSAFE_CARD_URLS) {
      const card = authorCard({ ...CARD_CONTENT, prUrl });

      expect(
        card.actions,
        `${JSON.stringify(prUrl)} survived into a clickable action`
      ).toBeUndefined();
      expect(card.body).toEqual(safe.body);
    }
  });

  it("renders markdown control characters as literal text in every field", () => {
    const card = authorCard(HOSTILE_CARD_CONTENT);
    const texts = cardTexts(card);

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(
        unescapedControlChars(text),
        `${JSON.stringify(text)} reaches the renderer with live markdown`
      ).toEqual([]);
    }

    expect(headline(card).text).toContain("\\[Click here\\]");
  });

  it("truncates a very long round label and PR title", () => {
    const card = authorCard(LONG_CARD_CONTENT);

    const value = factValue(card, "PR");
    expect(value, "the card has no PR fact").toBeDefined();
    expect(value).toHaveLength(MAX_CARD_FIELD_LENGTH);
    expect(value?.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(value?.startsWith(LONG_CARD_TEXT.slice(0, 40))).toBe(true);

    const text = headline(card).text;
    expect(text).toContain(TRUNCATION_SUFFIX);
    expect(text.length).toBeLessThanOrEqual(MAX_CARD_FIELD_LENGTH + 32);
  });

  it("wraps its headline rather than clipping it", () => {
    expect(headline(authorCard(CARD_CONTENT)).wrap).toBe(true);
  });
});

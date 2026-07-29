import { describe, it, expect } from "vitest";
import { escapeCardText } from "./escapeCardText";
import {
  INERT_PUNCTUATION,
  MARKDOWN_CONTROL_CHARS,
} from "../../test/fixtures/cardShape";
import { CARD_CONTENT } from "../../test/fixtures/fixtures";

// An Adaptive Card `TextBlock` renders limited markdown, and the three
// values PRSync puts in one — the round label, the PR title and the
// author's display name — are all typed by a person. A PR titled
// `[Reset your password](https://evil.example)` becomes a live link in a
// DM whose sender is PRSync itself, which is about as credible as
// phishing gets.
//
// Escaping is therefore applied uniformly to every text-bearing field
// rather than to the ones that look risky, so nobody has to remember
// that a `FactSet` value is safer than a `TextBlock` text. It is not.

describe("escapeCardText", () => {
  it("escapes every character a markdown renderer acts on", () => {
    for (const char of MARKDOWN_CONTROL_CHARS) {
      expect(
        escapeCardText(char),
        `${JSON.stringify(char)} reaches the card unescaped`
      ).toBe(`\\${char}`);
    }
  });

  it("leaves punctuation no renderer acts on alone", () => {
    // Escaping these would put visible backslashes into a DM for nothing
    // — a URL in a PR title is common, and `https\:\/\/` reads as broken.
    for (const char of INERT_PUNCTUATION) {
      expect(
        escapeCardText(char),
        `${JSON.stringify(char)} is escaped for no reason`
      ).toBe(char);
    }
  });

  it("renders a crafted link as the literal text someone typed", () => {
    expect(escapeCardText("[Click here](https://evil.example)")).toBe(
      "\\[Click here\\]\\(https://evil\\.example\\)"
    );
  });

  it("escapes a backslash, so an escape cannot be escaped away", () => {
    // Someone who types `\[` is trying to get a bare `\` followed by a
    // live `[`. Escaping the bracket without escaping the backslash
    // hands them exactly that.
    expect(escapeCardText("\\[")).toBe("\\\\\\[");
  });

  it("leaves ordinary text and non-ASCII characters untouched", () => {
    // Every round label this product generates carries an em dash, and
    // display names carry accents. Neither means anything to markdown.
    expect(escapeCardText(CARD_CONTENT.roundLabel)).toBe(
      CARD_CONTENT.roundLabel
    );
    expect(escapeCardText("Renée Ólafsdóttir")).toBe("Renée Ólafsdóttir");
    expect(escapeCardText("")).toBe("");
  });
});

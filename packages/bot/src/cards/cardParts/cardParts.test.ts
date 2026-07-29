import { describe, it, expect } from "vitest";
import {
  MAX_CARD_FIELD_LENGTH,
  TRUNCATION_SUFFIX,
  openPrAction,
  renderCardText,
} from "./cardParts";
import { CARD_CONTENT, UNSAFE_CARD_URLS } from "../../test/fixtures/fixtures";

// Both card tests drive these through a whole card, which is where they
// matter. What those cannot reach is the boundary itself — a value one
// character too long against one exactly at the cap — and the difference
// between an absent `actions` and an empty one, which `toEqual` would
// forgive and Teams would not.

describe("renderCardText", () => {
  it("leaves a value at the cap alone and truncates the one past it", () => {
    const atCap = "a".repeat(MAX_CARD_FIELD_LENGTH);
    expect(renderCardText(atCap)).toBe(atCap);

    const overCap = renderCardText("a".repeat(MAX_CARD_FIELD_LENGTH + 1));
    expect(overCap).toHaveLength(MAX_CARD_FIELD_LENGTH);
    expect(overCap.endsWith(TRUNCATION_SUFFIX)).toBe(true);
  });

  it("truncates before escaping, so a cut cannot strand a backslash", () => {
    // Escaping first would double the length and put the cut somewhere
    // the caller never asked for — potentially between a backslash and
    // the character it protects, handing the renderer a live one.
    const escaped = renderCardText("*".repeat(MAX_CARD_FIELD_LENGTH + 1));

    expect(escaped).toBe(
      `${"\\*".repeat(MAX_CARD_FIELD_LENGTH - 1)}${TRUNCATION_SUFFIX}`
    );
  });
});

describe("openPrAction", () => {
  it("is an Open PR button for an https URL", () => {
    expect(openPrAction(CARD_CONTENT.prUrl)).toEqual({
      actions: [
        { type: "Action.OpenUrl", title: "Open PR", url: CARD_CONTENT.prUrl },
      ],
    });
  });

  it("is nothing at all for an unsafe URL, not an empty action list", () => {
    // Spread into a card, `{}` leaves `actions` absent. An empty array
    // would leave Teams rendering an action bar with no button in it.
    for (const url of UNSAFE_CARD_URLS) {
      expect(
        openPrAction(url),
        `${JSON.stringify(url)} produced an actions property`
      ).not.toHaveProperty("actions");
    }
  });
});

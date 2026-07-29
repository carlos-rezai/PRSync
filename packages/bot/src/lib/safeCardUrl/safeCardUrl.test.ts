import { describe, it, expect } from "vitest";
import { safeCardUrl } from "./safeCardUrl";
import { CARD_CONTENT, UNSAFE_CARD_URLS } from "../../test/fixtures/fixtures";

// `prUrl` reaches the card's `Action.OpenUrl` from the round-open request
// body, which means it is attacker-controlled by the time the bot sees
// it. A button in a message from PRSync is exactly what a person clicks
// without reading, so the scheme is checked here and the builder omits
// the action entirely when this yields nothing — a notification with no
// button is a smaller failure than a notification with a hostile one.

describe("safeCardUrl", () => {
  it("passes an https URL through unchanged", () => {
    expect(safeCardUrl(CARD_CONTENT.prUrl)).toBe(CARD_CONTENT.prUrl);
  });

  it("accepts https however the scheme is cased or padded", () => {
    // ADO builds this URL, but it round-trips through a request body and
    // a queue message; neither preserves anything about it.
    expect(safeCardUrl(`  ${CARD_CONTENT.prUrl}  `)).toBe(CARD_CONTENT.prUrl);
    expect(safeCardUrl(CARD_CONTENT.prUrl.replace("https:", "HTTPS:"))).toBe(
      CARD_CONTENT.prUrl.replace("https:", "HTTPS:")
    );
  });

  it("yields nothing for any scheme that is not https", () => {
    for (const url of UNSAFE_CARD_URLS) {
      expect(
        safeCardUrl(url),
        `${JSON.stringify(url)} would have become a clickable button`
      ).toBeUndefined();
    }
  });

  it("preserves a URL's own encoding rather than re-serializing it", () => {
    // An ADO PR URL carries branch names and query strings that survive
    // a round trip through `new URL` only by luck. The value is checked,
    // not rewritten.
    const encoded =
      "https://dev.azure.com/contoso/PRSync/_git/PRSync/pullrequest/42?_a=files&path=%2Fsrc%2Fa%20b.ts";
    expect(safeCardUrl(encoded)).toBe(encoded);
  });
});

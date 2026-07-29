import { describe, it, expect } from "vitest";
import { dedupeKey } from "./dedupeKey";
import {
  DEDUPE_KEY,
  OTHER_RECIPIENT_ADO_ID,
  makeNotificationMessage,
} from "../../test/fixtures/fixtures";

// Delivery is at-least-once by deliberate choice, so the same message can
// arrive twice and this is the only thing that says the second one is the
// same DM. Everything about dedupe rests on the key: too coarse and a
// round-closed DM is swallowed by an unrelated round-opened one; too fine
// and every redelivery is a duplicate.
//
// The PR is NOT in the key — it is the partition the record lives in.

describe("dedupeKey", () => {
  it("is the round, the event and the recipient, in that order", () => {
    expect(dedupeKey(makeNotificationMessage())).toBe(DEDUPE_KEY);
  });

  it("gives one round's reviewers a key each", () => {
    // A fan-out is one message per reviewer, and they share a PR, a round
    // and an event. If the recipient did not separate them, the first DM
    // sent would mark the whole round delivered and nobody else would
    // hear about it.
    const message = makeNotificationMessage();
    const other = makeNotificationMessage({
      recipient: { ...message.recipient, adoId: OTHER_RECIPIENT_ADO_ID },
    });

    expect(dedupeKey(other)).not.toBe(dedupeKey(message));
  });

  it("separates a round's open from its close, and one round from the next", () => {
    const opened = makeNotificationMessage({ roundNumber: 2, event: "roundOpened" });
    const closed = makeNotificationMessage({ roundNumber: 2, event: "roundClosed" });
    const nextRound = makeNotificationMessage({
      roundNumber: 3,
      event: "roundOpened",
    });

    // The same person, the same PR, three different DMs they are owed.
    expect(new Set([opened, closed, nextRound].map(dedupeKey)).size).toBe(3);
  });

  it("is the same key for the same message delivered twice", () => {
    // The queue hands back a redelivery byte for byte, but the card is a
    // snapshot and a producer could re-enqueue with different content.
    // What identifies a DM is who is owed what, not what it says — a key
    // that moved with the content would never suppress anything.
    const first = makeNotificationMessage();
    const second = makeNotificationMessage({
      card: { ...first.card, roundLabel: "Round 2 — renamed after enqueue" },
    });

    expect(dedupeKey(second)).toBe(dedupeKey(first));
  });
});

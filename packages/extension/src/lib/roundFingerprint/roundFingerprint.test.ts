import { describe, it, expect } from "vitest";
import { roundFingerprint } from "./roundFingerprint";
import type { Round, RoundReviewer } from "../types/types";

// `roundFingerprint` is the panel's whole drift model. Feature 1's `Round`
// carries no etag or `updatedAt` (verified in PRD #7), so the panel derives
// its own digest of a round's SALIENT lifecycle fields and compares it to
// the viewer's baseline. A mismatch is Drift; equality is silence.
//
// The salient set is exactly five things (PRD #7 "Drift detection"):
// `roundNumber`, `status`, `phase`, `label`, and each reviewer's `done`.
// Everything else about a round is presentation or provenance and must NOT
// move the fingerprint, or the viewer gets a refresh banner for nothing.
//
// These tests pin the CONTRACT, never the digest format — they only ever
// compare two fingerprints to each other, so the implementation is free to
// change how it encodes them. Terminology:
// docs/ubiquitous-language.md.

const PR_KEY =
  "6f5e4d3c-2b1a-0908-1716-2524232221f0:aabbccdd-eeff-0011-2233-445566778899:42";

const REVIEWER_ONE_ID = "reviewer1-guid-0000-0000-0000-0000000002";
const REVIEWER_TWO_ID = "reviewer2-guid-0000-0000-0000-0000000003";

function makeReviewer(
  adoId: string,
  displayName: string,
  done: boolean,
  overrides: Partial<RoundReviewer> = {}
): RoundReviewer {
  return {
    adoId,
    email: `${displayName.toLowerCase().replace(/\s+/g, "")}@example.com`,
    displayName,
    isRequired: true,
    done,
    doneAt: done ? "2026-07-25T01:00:00.000Z" : undefined,
    teamsIdOverride: null,
    ...overrides,
  };
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    prKey: PR_KEY,
    roundNumber: 2,
    phase: "implementation",
    label: "Round 2 — Implementation Review",
    status: "open",
    quorum: 2,
    reviewers: [
      makeReviewer(REVIEWER_ONE_ID, "Rev One", false),
      makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
    ],
    prTitle: "Add the widget",
    prUrl: "https://example.com/pr/42",
    authorAdoId: "author-guid-0000-0000-0000-000000000001",
    authorName: "The Author",
    authorEmail: "author@example.com",
    openedAt: "2026-07-25T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("roundFingerprint — stability", () => {
  it("is stable across two structurally equal but distinct rounds", () => {
    // A poll always yields a FRESH object; identical state must stay quiet.
    expect(roundFingerprint(makeRound())).toBe(roundFingerprint(makeRound()));
  });

  it("is stable when the reviewer list arrives in a different order", () => {
    const forwards = makeRound();
    const backwards = makeRound({
      reviewers: [...forwards.reviewers].reverse(),
    });

    // Reordering is not a lifecycle change — nobody clicked anything.
    expect(roundFingerprint(backwards)).toBe(roundFingerprint(forwards));
  });

  it("ignores fields outside the salient lifecycle set", () => {
    // Provenance and presentation data can differ without being Drift.
    const noisy = makeRound({
      prTitle: "Add the widget (renamed in ADO)",
      prUrl: "https://example.com/pr/42?tab=files",
      authorName: "The Author (out of office)",
      authorEmail: "author.alt@example.com",
      openedAt: "2026-07-26T00:00:00.000Z",
      schemaVersion: 2,
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", false, {
          displayName: "Reviewer One",
          email: "rev.one@example.com",
        }),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", true, {
          doneAt: "2026-07-26T09:00:00.000Z",
        }),
      ],
    });

    expect(roundFingerprint(noisy)).toBe(roundFingerprint(makeRound()));
  });
});

describe("roundFingerprint — salient changes", () => {
  it("changes when the round number changes", () => {
    expect(roundFingerprint(makeRound({ roundNumber: 3 }))).not.toBe(
      roundFingerprint(makeRound())
    );
  });

  it("changes when the status changes", () => {
    // The author cancelled, or quorum closed it, while the viewer watched.
    expect(
      roundFingerprint(
        makeRound({
          status: "cancelled",
          cancelledAt: "2026-07-25T03:00:00.000Z",
        })
      )
    ).not.toBe(roundFingerprint(makeRound()));
  });

  it("changes when the phase changes", () => {
    expect(roundFingerprint(makeRound({ phase: "spec" }))).not.toBe(
      roundFingerprint(makeRound())
    );
  });

  it("changes when the label changes", () => {
    // The author renamed the round from their own panel.
    expect(
      roundFingerprint(
        makeRound({ label: "Round 2 — Please re-read the spec" })
      )
    ).not.toBe(roundFingerprint(makeRound()));
  });

  it("changes when any reviewer's done flips", () => {
    const base = makeRound();

    // Another reviewer finished their pass — the canonical drift event.
    const otherFinished = makeRound({
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", true),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", true),
      ],
    });
    expect(roundFingerprint(otherFinished)).not.toBe(roundFingerprint(base));

    // ...and un-ticking one is just as much a change.
    const otherUndone = makeRound({
      reviewers: [
        makeReviewer(REVIEWER_ONE_ID, "Rev One", false),
        makeReviewer(REVIEWER_TWO_ID, "Rev Two", false),
      ],
    });
    expect(roundFingerprint(otherUndone)).not.toBe(roundFingerprint(base));
  });
});

describe("roundFingerprint — the no-round case", () => {
  it("gives a stable fingerprint for no round that no round can collide with", () => {
    // A `204` is a state the viewer can hold a baseline against too: it
    // must stay quiet while there is still no round, and register as Drift
    // the moment the author opens one.
    expect(roundFingerprint(null)).toBe(roundFingerprint(null));
    expect(roundFingerprint(null)).not.toBe(roundFingerprint(makeRound()));
  });
});

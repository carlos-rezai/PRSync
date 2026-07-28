import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createIdentityDirectory } from "./IdentityDirectory";
import {
  makeIdentityRepository,
  type InMemoryTeamsIdentityRepository,
} from "../../test/fixtures/fakes";
import {
  CONVERSATION_ID,
  PERSON,
  PERSON_EMAIL_VARIANTS,
  REFRESHED_CONVERSATION_ID,
  STRANGER_EMAIL,
  makeCapturedIdentity,
  makeConversationRef,
} from "../../test/fixtures/fixtures";

// IdentityDirectory is the deep module of this slice: three verbs —
// capture, resolve, forget — behind which email normalization,
// conversation-reference serialization and the repository disappear
// entirely. Nothing above it ever sees a row key or a serialized
// reference.
//
// Driven against an in-memory repository, in the spirit of
// `packages/api/src/services/RoundService/RoundService.test.ts`: the
// assertions are what a caller can observe through the three verbs, not
// what got written where.

let repository: InMemoryTeamsIdentityRepository;

beforeEach(() => {
  repository = makeIdentityRepository();
});

describe("IdentityDirectory — capture", () => {
  it("makes a captured person resolvable, reference intact", async () => {
    const directory = createIdentityDirectory(repository);
    const captured = makeCapturedIdentity();

    await directory.capture(captured);

    // Adding the app IS the registration: one activity in, and everything
    // needed to DM that person comes back out.
    const resolved = await directory.resolve(PERSON.email);
    expect(resolved).toMatchObject({
      email: PERSON.email,
      aadObjectId: PERSON.aadObjectId,
      teamsUserId: PERSON.teamsUserId,
      displayName: PERSON.displayName,
    });
    // The reference comes back as the object it went in as — callers never
    // see the serialization the row keeps it in.
    expect(resolved?.conversationReference).toEqual(
      captured.conversationReference
    );
  });

  it("stamps the capture with an ISO timestamp", async () => {
    const directory = createIdentityDirectory(repository);

    await directory.capture(makeCapturedIdentity());

    // Every date in this codebase is an ISO string, and this one is how
    // anyone later tells a fresh reference from one nobody has touched
    // since.
    const updatedAt = (await directory.resolve(PERSON.email))?.updatedAt ?? "";
    expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
  });

  it("keys every spelling of one address to the same identity", async () => {
    const directory = createIdentityDirectory(repository);

    // Capture under one spelling...
    await directory.capture(
      makeCapturedIdentity({ email: PERSON_EMAIL_VARIANTS[0] })
    );

    // ...and resolve under every other. ADO hands PRSync a `uniqueName`
    // and Teams hands it a `userPrincipalName`; if the two spellings key
    // different rows, the person installed the app and will never hear
    // from it.
    for (const variant of PERSON_EMAIL_VARIANTS) {
      expect(
        await directory.resolve(variant),
        `${JSON.stringify(variant)} resolved to nobody`
      ).not.toBeNull();
    }

    // And it is ONE identity, not four rows that happen to answer.
    expect(repository.rows.size).toBe(1);
  });
});

describe("IdentityDirectory — refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces a stale conversation reference with the one on the newer activity", async () => {
    const directory = createIdentityDirectory(repository);

    vi.setSystemTime(new Date("2026-07-27T09:00:00.000Z"));
    await directory.capture(
      makeCapturedIdentity({
        conversationReference: makeConversationRef(CONVERSATION_ID),
      })
    );

    // Any later inbound activity re-persists. References go stale, and
    // refreshing on every activity is what stops a person's notifications
    // dying silently.
    vi.setSystemTime(new Date("2026-07-28T09:00:00.000Z"));
    await directory.capture(
      makeCapturedIdentity({
        conversationReference: makeConversationRef(REFRESHED_CONVERSATION_ID),
      })
    );

    const resolved = await directory.resolve(PERSON.email);
    expect(resolved?.conversationReference).toEqual(
      makeConversationRef(REFRESHED_CONVERSATION_ID)
    );
    expect(resolved?.updatedAt).toBe("2026-07-28T09:00:00.000Z");
    expect(repository.rows.size).toBe(1);
  });
});

describe("IdentityDirectory — resolve", () => {
  it("returns null for someone who never installed the app", async () => {
    const directory = createIdentityDirectory(repository);

    // Unreachable, which is a logged fact rather than an error — so this
    // has to be an answer, not a throw.
    expect(await directory.resolve(STRANGER_EMAIL)).toBeNull();
  });
});

describe("IdentityDirectory — forget", () => {
  it("makes an uninstalled person unresolvable, whatever the spelling", async () => {
    const directory = createIdentityDirectory(repository);
    await directory.capture(makeCapturedIdentity());

    await directory.forget(PERSON_EMAIL_VARIANTS[1]);

    // A dead reference left behind burns the full retry budget into the
    // poison queue on every future round, and PRSync should hold a
    // conversation reference exactly as long as the person has the app.
    expect(await directory.resolve(PERSON.email)).toBeNull();
    expect(repository.rows.size).toBe(0);
  });

  it("forgetting someone who was never captured is not an error", async () => {
    const directory = createIdentityDirectory(repository);

    // A redelivered uninstall, or one for an install that never
    // completed, arrives at a directory that already holds nothing. That
    // is the wanted state, not a fault.
    await expect(directory.forget(STRANGER_EMAIL)).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TeamsInfo, TestAdapter } from "botbuilder";
import { createTeamsBot } from "./TeamsBot";
import { createIdentityDirectory } from "../../services";
import { makeIdentityRepository } from "../../test/fixtures/fakes";
import {
  CONVERSATION_ID,
  PERSON,
  REFRESHED_CONVERSATION_ID,
  installActivity,
  makeTeamsMember,
  messageActivity,
  otherMemberAddedActivity,
  uninstallActivity,
} from "../../test/fixtures/fixtures";
import type { IdentityDirectory } from "../../services";

// `teams/` is the exact analogue of the extension's `sdk/` layer: the one
// place that imports the vendor SDK. So it is the one place that mocks
// it — and only at the boundary that leaves the process.
//
// That boundary is `TeamsInfo.getMember`. Teams puts no email on an
// activity, so the bot has to ask the connector for the member's profile;
// the routing under test is everything either side of that call, which is
// why it is the only thing faked. Everything else here is real: a real
// `ActivityHandler` driven by Bot Framework's own `TestAdapter`, a real
// `IdentityDirectory`, over an in-memory repository.
//
// The activities are the ones Teams actually posts. An install is a
// `conversationUpdate` carrying THE BOT in `membersAdded` — not the
// person — and an uninstall is the same event with the bot in
// `membersRemoved`. Getting that backwards produces a bot that captures
// nobody and looks entirely healthy doing it.

// The fake is created in a hoisted block rather than reached for through
// `vi.mocked(TeamsInfo.getMember)`: the mock factory is hoisted above the
// imports, so the fake has to exist before them, and holding it by name
// keeps the test from taking a reference to a method torn off its class.
const { getMember } = vi.hoisted(() => ({
  getMember: vi.fn<typeof TeamsInfo.getMember>(),
}));

vi.mock("botbuilder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("botbuilder")>();
  return { ...actual, TeamsInfo: { getMember } };
});

let directory: IdentityDirectory;

/** The bot, wired to a real directory, behind Bot Framework's test host. */
function hostBot(): TestAdapter {
  const bot = createTeamsBot(directory);
  return new TestAdapter((context) => bot.run(context));
}

beforeEach(() => {
  getMember.mockResolvedValue(makeTeamsMember());
  directory = createIdentityDirectory(makeIdentityRepository());
});

describe("the Teams bot — install capture", () => {
  it("captures a person's identity when they add the app, with nothing else asked of them", async () => {
    await hostBot().processActivity(installActivity());

    // Nobody registers anywhere. Sideloading PRSync IS the registration,
    // and this row is the whole reason the product can reach them later.
    const resolved = await directory.resolve(PERSON.email);
    expect(resolved).toMatchObject({
      email: PERSON.email,
      aadObjectId: PERSON.aadObjectId,
      teamsUserId: PERSON.teamsUserId,
      displayName: PERSON.displayName,
    });
    expect(resolved?.conversationReference).toMatchObject({
      conversation: { id: CONVERSATION_ID },
    });
  });

  it("does not capture anyone when the member added is not the bot", async () => {
    await hostBot().processActivity(otherMemberAddedActivity());

    // `conversationUpdate` is a shared event shape. Treating any
    // membersAdded as an install captures an identity for somebody who
    // installed nothing — and then PRSync DMs a person who never opted in.
    expect(await directory.resolve(PERSON.email)).toBeNull();
  });
});

describe("the Teams bot — uninstall", () => {
  it("forgets a person when they remove the app", async () => {
    const adapter = hostBot();
    await adapter.processActivity(installActivity());
    expect(await directory.resolve(PERSON.email)).not.toBeNull();

    await adapter.processActivity(uninstallActivity());

    // A reference kept past the uninstall is dead: it burns the full
    // retry budget into the poison queue on every future round, and it is
    // PII PRSync no longer has any reason to hold.
    expect(await directory.resolve(PERSON.email)).toBeNull();
  });
});

describe("the Teams bot — messages", () => {
  it("replies to a message, so a person can confirm their install worked", async () => {
    const adapter = hostBot();

    await adapter.processActivity(messageActivity("did that work?"));

    // v1 cards are link-out only and arrive unprompted, so this reply is
    // the ONLY way someone can check that adding the app did anything.
    // The bot is deliberately not notification-only for exactly this.
    const replies = adapter.activityBuffer;
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe("message");
    expect(String(replies[0]?.text ?? "")).toContain("PRSync");
  });

  it("re-persists the conversation reference carried by a later activity", async () => {
    const adapter = hostBot();
    await adapter.processActivity(installActivity(CONVERSATION_ID));

    await adapter.processActivity(
      messageActivity("still there?", REFRESHED_CONVERSATION_ID)
    );

    // References go stale. Refreshing on any inbound activity is cheap
    // insurance against the alternative: notifications that stop arriving
    // with nothing reporting a fault.
    const resolved = await directory.resolve(PERSON.email);
    expect(resolved?.conversationReference).toMatchObject({
      conversation: { id: REFRESHED_CONVERSATION_ID },
    });
  });
});

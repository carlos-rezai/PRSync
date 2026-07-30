import { describe, it, expect } from "vitest";
import { createBotAdapter } from "./BotAdapter";
import type { BotConfig } from "../BotConfig/BotConfig";

// This test is deliberately thin, and that is a decision rather than an
// oversight.
//
// Almost everything the adapter does is Bot Framework's: validating the
// channel's JWT against app id, password and tenant, answering 401 when
// that fails, opening an authenticated connector client. Asserting any of
// it would mean re-implementing a vendor in the test — the same stance
// `BotConfig.test.ts` records for itself, and the reason the settings are
// tested there while the validation they drive is not tested anywhere.
//
// What is left is what PRSync owns: that a valid config yields an adapter
// at all, and that it exposes the two operations the rest of the package
// depends on. Both are assumptions made without checking today — the
// composition root builds this once and hands it in two directions, so a
// constructor that throws on a shape the vendor stopped accepting, or a
// method renamed in a major version, currently surfaces as a Function App
// that fails at host start with a stack trace from inside `node_modules`.

const CONFIG: BotConfig = {
  appId: "6f5e4d3c-2b1a-0908-1716-2524232221f0",
  appPassword: "an-azure-bot-client-secret",
  tenantId: "11111111-2222-3333-4444-555555555555",
  appType: "SingleTenant",
};

describe("createBotAdapter", () => {
  it("builds an adapter from a valid config", () => {
    expect(() => createBotAdapter(CONFIG)).not.toThrow();
  });

  it("exposes the inbound and proactive operations the package depends on", () => {
    const adapter = createBotAdapter(CONFIG);

    // One adapter, both directions. `process` is the inbound half the
    // messaging endpoint drives; `continueConversationAsync` is the
    // outbound half the sender drives to open a proactive 1:1 DM. Both
    // are reached through narrowed structural ports, which means neither
    // consumer's test would notice if the vendor stopped supplying them.
    expect(typeof adapter.process).toBe("function");
    expect(typeof adapter.continueConversationAsync).toBe("function");
  });
});

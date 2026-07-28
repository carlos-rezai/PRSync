import { describe, it, expect } from "vitest";
import { readBotConfig } from "./BotHost";

// `/api/messages` is anonymous-auth of necessity — Azure Bot Service
// cannot present a Function key. What keeps it from being an open
// endpoint is entirely the adapter: it validates the Bot Framework JWT
// against the app id, the password and the tenant on every request.
//
// So the settings ARE the authentication. A missing password or a tenant
// that silently defaults does not fail loudly; it produces a bot that
// accepts tokens it should not, or accepts none at all, and either way
// the only symptom is DMs that never arrive.
//
// The adapter's own JWT validation is not tested here — that is Bot
// Framework's, and a test would only re-implement a vendor. What is
// tested is the one part PRSync owns: that the values it hands the
// adapter are present and say what they are meant to say.

const COMPLETE_ENV = {
  MICROSOFT_APP_ID: "6f5e4d3c-2b1a-0908-1716-2524232221f0",
  MICROSOFT_APP_PASSWORD: "an-azure-bot-client-secret",
  MICROSOFT_APP_TENANT_ID: "11111111-2222-3333-4444-555555555555",
  MICROSOFT_APP_TYPE: "SingleTenant",
} as const;

describe("readBotConfig", () => {
  it("reads the app id, password, tenant and type the adapter authenticates with", () => {
    expect(readBotConfig({ ...COMPLETE_ENV })).toEqual({
      appId: COMPLETE_ENV.MICROSOFT_APP_ID,
      appPassword: COMPLETE_ENV.MICROSOFT_APP_PASSWORD,
      tenantId: COMPLETE_ENV.MICROSOFT_APP_TENANT_ID,
      appType: "SingleTenant",
    });
  });

  it("refuses to start when a setting is missing or blank, naming it", () => {
    for (const key of [
      "MICROSOFT_APP_ID",
      "MICROSOFT_APP_PASSWORD",
      "MICROSOFT_APP_TENANT_ID",
      "MICROSOFT_APP_TYPE",
    ] as const) {
      const missing = { ...COMPLETE_ENV, [key]: undefined };
      const blank = { ...COMPLETE_ENV, [key]: "   " };

      // Named, because the operator reading this line is looking at four
      // near-identical settings in an App Service configuration blade.
      expect(() => readBotConfig(missing), `${key} missing`).toThrowError(key);
      expect(() => readBotConfig(blank), `${key} blank`).toThrowError(key);
    }
  });

  it("refuses an app type other than SingleTenant", () => {
    // The bot is sideloaded inside one org's tenant and will never be
    // listed in the Teams Store. Multi-tenant widens the token audience to
    // every directory in the Bot Framework channel — a setting nobody
    // would notice was wrong, because the bot keeps working.
    expect(() =>
      readBotConfig({ ...COMPLETE_ENV, MICROSOFT_APP_TYPE: "MultiTenant" })
    ).toThrowError(/SingleTenant/);
  });
});

// The bot's authentication, as four settings.
//
// This module imports no vendor SDK and is pure, which technically
// qualifies it for `lib/`. It stays in `teams/` because it IS the bot's
// authentication, inseparable from the adapter it configures — `teams/`
// is where a reader looks for it, and `lib/` holding deployment settings
// would be a worse boundary than none at all.

/**
 * The settings the adapter authenticates every inbound request with.
 * `/api/messages` is anonymous of necessity — Azure Bot Service cannot
 * present a Function key — so these four values ARE the authentication.
 */
export interface BotConfig {
  readonly appId: string;
  readonly appPassword: string;
  readonly tenantId: string;
  readonly appType: "SingleTenant";
}

const SETTINGS = {
  appId: "MICROSOFT_APP_ID",
  appPassword: "MICROSOFT_APP_PASSWORD",
  tenantId: "MICROSOFT_APP_TENANT_ID",
  appType: "MICROSOFT_APP_TYPE",
} as const;

/**
 * Reads the bot's settings, refusing to start without them. A missing
 * password or a tenant that silently defaults does not fail loudly on
 * its own; it produces a bot that accepts tokens it should not, or
 * accepts none at all, and either way the only symptom is DMs that never
 * arrive.
 */
export function readBotConfig(
  env: Record<string, string | undefined>
): BotConfig {
  const required = (key: string): string => {
    const value = env[key]?.trim() ?? "";
    if (value === "") {
      // Named, because the operator reading this line is looking at four
      // near-identical settings in a configuration blade.
      throw new Error(
        `${key} is not set. The bot cannot authenticate without it.`
      );
    }
    return value;
  };

  const appType = required(SETTINGS.appType);
  if (appType !== "SingleTenant") {
    // PRSync is sideloaded inside one org's tenant and will never be
    // listed in the Teams Store. MultiTenant widens the token audience to
    // every directory in the Bot Framework channel — a setting nobody
    // would notice was wrong, because the bot keeps working.
    throw new Error(
      `${SETTINGS.appType} is "${appType}", but PRSync must be registered SingleTenant.`
    );
  }

  return {
    appId: required(SETTINGS.appId),
    appPassword: required(SETTINGS.appPassword),
    tenantId: required(SETTINGS.tenantId),
    appType,
  };
}

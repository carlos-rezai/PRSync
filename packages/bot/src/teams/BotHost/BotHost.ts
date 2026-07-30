import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
} from "botbuilder";
import type { BotConfig } from "../BotConfig/BotConfig";

// `teams/` is the exact analogue of the extension's `sdk/` layer: the one
// place that imports the vendor SDK. Everything below it — the
// directory, the repository, the helpers — is testable with no Bot
// Framework in the test at all, and stays that way only as long as this
// layer stays the sole importer.
//
// One thing lives here: the adapter, constructed. The settings it
// authenticates with are its sibling `BotConfig`, the activity routing it
// runs a turn against is `TeamsBot`, and the HTTP translation in front of
// it is `MessagingEndpoint`.

/**
 * The adapter, authenticated with the bot's settings.
 *
 * Built once and shared: it is both the inbound path (validating the
 * channel's JWT on every activity) and the outbound one (opening a
 * proactive 1:1 conversation to send a card), and a second instance
 * would be a second connector-client cache authenticating as the same
 * bot.
 */
export function createBotAdapter(config: BotConfig): CloudAdapter {
  return new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication(
      {
        MicrosoftAppId: config.appId,
        MicrosoftAppTenantId: config.tenantId,
      },
      new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: config.appId,
        MicrosoftAppPassword: config.appPassword,
        MicrosoftAppType: config.appType,
        MicrosoftAppTenantId: config.tenantId,
      })
    )
  );
}

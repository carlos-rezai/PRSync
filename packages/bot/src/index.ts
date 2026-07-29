import { app } from "@azure/functions";
import {
  makeNotificationWorkerHandler,
  makeTeamsMessagesHandler,
  notificationWorkerOptions,
  teamsMessagesOptions,
} from "./functions";
import {
  createIdentityDirectory,
  createNotificationDispatcher,
} from "./services";
import {
  createNotificationLogRepository,
  createTeamsIdentityRepository,
} from "./storage";
import {
  createBotAdapter,
  createMessagingEndpoint,
  createTeamsBot,
  createTeamsSender,
  readBotConfig,
} from "./teams";

// The composition root: the one place that reads the environment and
// decides which implementation of each seam is live. Every layer below
// takes its collaborators as arguments, which is what lets the whole
// install path be driven in tests with none of this present.
//
// It runs at host start, so a missing setting fails the app rather than
// the first activity — see `readBotConfig`.

const connectionString = process.env.AZURE_TABLES_CONNECTION_STRING ?? "";
if (connectionString.trim() === "") {
  throw new Error(
    "AZURE_TABLES_CONNECTION_STRING is not set. The bot cannot persist who to reach."
  );
}

const directory = createIdentityDirectory(
  createTeamsIdentityRepository(connectionString)
);

// One adapter, both directions: it validates the channel's JWT on every
// inbound activity and authenticates the bot on every outbound DM.
const config = readBotConfig(process.env);
const adapter = createBotAdapter(config);

app.http("teamsMessages", {
  ...teamsMessagesOptions,
  handler: makeTeamsMessagesHandler(
    createMessagingEndpoint(adapter, createTeamsBot(directory))
  ),
});

app.storageQueue("notificationWorker", {
  ...notificationWorkerOptions(process.env),
  handler: makeNotificationWorkerHandler(
    createNotificationDispatcher(
      directory,
      createTeamsSender(adapter, config.appId),
      createNotificationLogRepository(connectionString)
    )
  ),
});

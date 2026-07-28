import { app } from "@azure/functions";
import { makeTeamsMessagesHandler, teamsMessagesOptions } from "./functions";
import { createIdentityDirectory } from "./services";
import { createTeamsIdentityRepository } from "./storage";
import {
  createMessagingEndpoint,
  createTeamsBot,
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
const endpoint = createMessagingEndpoint(
  readBotConfig(process.env),
  createTeamsBot(directory)
);

app.http("teamsMessages", {
  ...teamsMessagesOptions,
  handler: makeTeamsMessagesHandler(endpoint),
});

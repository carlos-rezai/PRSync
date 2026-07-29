import { app, InvocationContext } from "@azure/functions";
import {
  cancelRoundOptions,
  editLabelOptions,
  getCurrentRoundOptions,
  makeCancelRoundHandler,
  makeEditLabelHandler,
  makeGetCurrentRoundHandler,
  makeOpenRoundHandler,
  makeToggleDoneHandler,
  openRoundOptions,
  toggleDoneOptions,
} from "./functions";
import { readApiConfig } from "./lib";
import {
  createAdoIdentityResolver,
  QueueNotificationPort,
  RoundService,
} from "./services";
import { createNotificationQueue, createRoundRepository } from "./storage";

// The composition root: the one place that reads the environment, decides
// which implementation of each seam is live, and mounts the five HTTP
// entry points. Every layer below takes its collaborators as arguments,
// which is what lets all of them be driven in tests with none of this
// present.
//
// It runs at host start, so a missing setting fails the app rather than
// the first request that happens to need it — see `readApiConfig`.
//
// This file is `main` in package.json. In the Functions v4 model that is
// the whole of function discovery: the host loads exactly what `main`
// names and registers whatever that file registered. A `main` pointing
// anywhere else starts cleanly, registers nothing, and serves 404 for
// every route while looking perfectly healthy.

const config = readApiConfig(process.env);

/**
 * Where a notification failure goes.
 *
 * The object graph is built here, at host start, so there is no
 * invocation to log against — and a context constructed outside one falls
 * back to the worker's console, which the Functions host captures into
 * the app's logs. That is the only logging surface available at
 * composition time, and it is the SDK's own fallback rather than a
 * `console` call of ours.
 */
const notificationLog = new InvocationContext({
  functionName: "notifications",
});

const service = new RoundService({
  // A repository, not a `TableClient`: `@azure/data-tables` stays inside
  // storage/, including here.
  repository: createRoundRepository(config.tablesConnectionString),
  // The ONE line that decides which notification port is live. Nothing
  // else in the package names an implementation, so this is the whole of
  // the change from the Noop stub to the real queue producer — the stub
  // stays in the codebase for tests and local runs where the queue is not
  // the point.
  notifications: new QueueNotificationPort({
    // A queue, not a `QueueClient`: `@azure/storage-queue` stays inside
    // storage/ for the same reason the tables SDK does.
    queue: createNotificationQueue(
      config.queuesConnectionString,
      config.notificationQueueName
    ),
    logError: (message, error) => {
      notificationLog.error(message, error);
    },
  }),
  defaultQuorum: config.defaultQuorum,
});

// Every handler authorizes through this seam. The routes are anonymous to
// the Functions host of necessity (the caller is a browser-side panel that
// cannot hold a Function key) — this is what actually decides who a caller
// is, and every handler answers 401 when it yields nothing.
const identity = createAdoIdentityResolver();

app.http("getCurrentRound", {
  ...getCurrentRoundOptions,
  handler: makeGetCurrentRoundHandler(service, identity),
});

app.http("openRound", {
  ...openRoundOptions,
  handler: makeOpenRoundHandler(service, identity),
});

app.http("toggleDone", {
  ...toggleDoneOptions,
  handler: makeToggleDoneHandler(service, identity),
});

app.http("editLabel", {
  ...editLabelOptions,
  handler: makeEditLabelHandler(service, identity),
});

app.http("cancelRound", {
  ...cancelRoundOptions,
  handler: makeCancelRoundHandler(service, identity),
});

import { describe, it, expect } from "vitest";
import {
  makeNotificationWorkerHandler,
  notificationWorkerOptions,
} from "./notificationWorker";
import {
  makeContext,
  makeNotificationDispatcher,
} from "../../test/fixtures/fakes";
import { makeNotificationMessage } from "../../test/fixtures/fixtures";

// The `functions/` layer is thin here for the same reason it is thin for
// `teamsMessages`: every rule about what a notification message means —
// which card, whose chat, what an unreachable recipient costs — lives
// behind `NotificationDispatcher`. This module hands one message over and
// returns.

describe("notificationWorker", () => {
  it("hands the queued message to the dispatcher", async () => {
    const dispatcher = makeNotificationDispatcher();
    const message = makeNotificationMessage();

    await makeNotificationWorkerHandler(dispatcher)(message, makeContext());

    expect(dispatcher.dispatch).toHaveBeenCalledWith(message);
  });

  it("reads a message that arrives as raw JSON text", async () => {
    // The Functions host hands a queue entry over already deserialized
    // when it recognises JSON, and as text when it does not. Which one
    // arrives is a property of the host and the producer's encoding, not
    // of the message — so the same DM must come out either way rather
    // than depending on a runtime detail nobody controls from here.
    const dispatcher = makeNotificationDispatcher();
    const message = makeNotificationMessage({ event: "roundClosed" });

    await makeNotificationWorkerHandler(dispatcher)(
      JSON.stringify(message),
      makeContext()
    );

    expect(dispatcher.dispatch).toHaveBeenCalledWith(message);
  });

  it("lets a transient failure escape, so the host retries and eventually poisons", async () => {
    // Returning normally completes the queue message; throwing hands it
    // back. That split IS this layer's whole error handling, and the
    // dispatcher is what decides which side a failure falls on — so a
    // rejection has to travel straight through rather than being caught
    // here, where catching it would silently drop a "safe to proceed".
    const dispatcher = makeNotificationDispatcher();
    const failure = new Error("Bot Framework: 503 Service Unavailable");
    dispatcher.dispatch.mockRejectedValueOnce(failure);

    await expect(
      makeNotificationWorkerHandler(dispatcher)(
        makeNotificationMessage(),
        makeContext()
      )
    ).rejects.toThrow(failure);
  });

  it("triggers on prsync-notifications when nothing is configured", () => {
    // `connection` names the app setting holding the connection string —
    // it is not the string itself. Both are settings so the two Function
    // Apps can share one storage account or split it.
    expect(notificationWorkerOptions({})).toEqual({
      queueName: "prsync-notifications",
      connection: "AZURE_QUEUES_CONNECTION_STRING",
    });
  });

  it("takes the queue name and connection setting from app settings", () => {
    expect(
      notificationWorkerOptions({
        PRSYNC_NOTIFICATION_QUEUE_NAME: "prsync-notifications-staging",
        PRSYNC_NOTIFICATION_QUEUE_CONNECTION: "BOT_QUEUES_CONNECTION_STRING",
      })
    ).toEqual({
      queueName: "prsync-notifications-staging",
      connection: "BOT_QUEUES_CONNECTION_STRING",
    });
  });
});

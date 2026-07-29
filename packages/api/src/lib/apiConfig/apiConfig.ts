// Everything the API needs from its environment, read in one place at
// host start rather than at the first request that happens to need it.
//
// The two settings fail in opposite directions, which is why this is a
// function with tests rather than two `process.env` reads in the
// composition root:
//
//   - The connection string is absent or it is not. A missing one has no
//     sane fallback, and the failure it produces lazily — every request
//     500ing from inside the storage layer — names nothing an operator
//     can act on. So it throws at start, naming the setting.
//   - The quorum has a documented default of 2 and is therefore usually
//     unset. What it must never do is default SILENTLY past a value the
//     operator did set: `PRSYNC_DEFAULT_QUORUM=0` or `=two` shipping as 2
//     is a round-closing rule quietly not being the one that was
//     configured, and nothing downstream can tell the difference.
//
// Mirrors `readBotConfig` in packages/bot, for the same reason: a setting
// that fails loudly at start beats one that fails subtly forever.

/**
 * How many reviewers must be Done before a round closes, when nothing is
 * configured. Two, not unanimity — see docs/ubiquitous-language.md,
 * "Quorum".
 */
export const DEFAULT_QUORUM = 2;

/**
 * The queue the notifications go onto when nothing is configured. Must
 * match the bot worker's own default — the two apps meet here and nowhere
 * else, so a disagreement is a queue that fills and DMs that never arrive.
 */
export const DEFAULT_NOTIFICATION_QUEUE_NAME = "prsync-notifications";

const SETTINGS = {
  tablesConnectionString: "AZURE_TABLES_CONNECTION_STRING",
  queuesConnectionString: "AZURE_QUEUES_CONNECTION_STRING",
  notificationQueueName: "PRSYNC_NOTIFICATION_QUEUE_NAME",
  defaultQuorum: "PRSYNC_DEFAULT_QUORUM",
} as const;

export interface ApiConfig {
  /** The Table Storage account the `Rounds` table lives in. */
  tablesConnectionString: string;
  /**
   * The Queue Storage account the notification queue lives in. A separate
   * setting from the tables one on purpose: the two Function Apps may
   * split storage accounts, and the producer has to be pointable at
   * whichever account the bot's trigger is listening on.
   */
  queuesConnectionString: string;
  /** The queue the notification producer writes to. */
  notificationQueueName: string;
  /** The quorum a round is opened with. */
  defaultQuorum: number;
}

/**
 * Reads the API's configuration, throwing on anything it cannot honour.
 * Called once, from the composition root, so a misconfigured app fails to
 * start instead of failing one request at a time.
 */
export function readApiConfig(
  env: Record<string, string | undefined>
): ApiConfig {
  // Blank is unset: an App Service setting with its value cleared and one
  // that was never added are the same act, and there is nothing for a
  // distinction between them to mean.
  const connectionString = env[SETTINGS.tablesConnectionString]?.trim() ?? "";
  if (connectionString === "") {
    // Named, because the operator reading the failure is looking at a
    // configuration blade, not at this file.
    throw new Error(
      `${SETTINGS.tablesConnectionString} is not set. The API cannot reach the Rounds table without it.`
    );
  }

  // Fails at start for the same reason, and for a sharper one: an API
  // that starts perfectly healthy and quietly notifies nobody is the
  // exact failure this product exists to prevent. Nothing lazy would
  // discover it — no request 500s and no round misbehaves; the DMs simply
  // never arrive.
  const queuesConnectionString =
    env[SETTINGS.queuesConnectionString]?.trim() ?? "";
  if (queuesConnectionString === "") {
    throw new Error(
      `${SETTINGS.queuesConnectionString} is not set. The API cannot queue a notification without it.`
    );
  }

  const queueName = env[SETTINGS.notificationQueueName]?.trim() ?? "";

  return {
    tablesConnectionString: connectionString,
    queuesConnectionString,
    notificationQueueName:
      queueName === "" ? DEFAULT_NOTIFICATION_QUEUE_NAME : queueName,
    defaultQuorum: readQuorum(env[SETTINGS.defaultQuorum]),
  };
}

function readQuorum(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_QUORUM;

  // Digits only, so `1.5`, `1e1`, `-1` and `2 reviewers` are refused
  // rather than coerced — every one of them is a value someone typed on
  // purpose, and falling back to the default would leave the
  // round-closing rule silently different from the configured one.
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(
      `${SETTINGS.defaultQuorum} is "${value}", which is not a whole number of reviewers.`
    );
  }
  return Number(value);
}

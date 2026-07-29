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

const SETTINGS = {
  tablesConnectionString: "AZURE_TABLES_CONNECTION_STRING",
  defaultQuorum: "PRSYNC_DEFAULT_QUORUM",
} as const;

export interface ApiConfig {
  /** The Table Storage account the `Rounds` table lives in. */
  tablesConnectionString: string;
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

  return {
    tablesConnectionString: connectionString,
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

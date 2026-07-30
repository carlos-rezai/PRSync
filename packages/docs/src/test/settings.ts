import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SETTING_PATTERN } from "../lib";
import { readSourceFiles } from "../repo";
import { repoRoot } from "./documents";

// Which settings the code actually reads, discovered from source.
//
// It sits beside `documents.ts` for the same reason that file does: both
// specs that assert about configuration need it, and it is the other half
// of the same question — `documents.ts` says what a reader is shown,
// this says what a deploy must be given.
//
// Names are discovered rather than listed anywhere on purpose. A
// hardcoded list is one more thing to forget to update, and would make
// both assertions pass by agreeing with themselves.

const packagesDir = resolve(repoRoot, "packages");

export interface DiscoveredSetting {
  /** The workspace directory that reads it, e.g. `bot`. */
  package: string;
  /** The setting name, e.g. `MICROSOFT_APP_TENANT_ID`. */
  name: string;
}

/**
 * Every setting name that ships, sorted so a failure lists them
 * predictably. Tests and `src/test/` are skipped: a fixture naming a
 * setting is not a deployment requirement, and several of them do.
 */
export function discoverSettings(): DiscoveredSetting[] {
  const found = new Map<string, DiscoveredSetting>();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const src = resolve(packagesDir, entry.name, "src");
    if (!entry.isDirectory() || !existsSync(src)) continue;

    const pkg = entry.name;
    const sources = readSourceFiles({
      root: src,
      exclude: (path) => path.startsWith("test/"),
    });

    for (const file of sources) {
      for (const name of file.text.match(SETTING_PATTERN) ?? []) {
        found.set(`${pkg}:${name}`, { package: pkg, name });
      }
    }
  }

  return [...found.values()].sort((a, b) =>
    `${a.package}:${a.name}`.localeCompare(`${b.package}:${b.name}`)
  );
}

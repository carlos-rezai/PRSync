import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// These assert lint POLICY, not runtime behaviour — the two parts of
// issue #15 that a clean `npm run lint` cannot prove on its own.
//
// "No findings in packages/api" is verified by running the linter; there
// is no point re-running it inside the suite. But two things survive a
// clean run and would regress silently:
//
//   1. WHY the `_`-prefixed bindings are clean. `_context`, `_dropped`
//      and `_omitted` are a deliberate convention meaning "bound but
//      intentionally unused", and the fix is to teach the linter about
//      it — not to rename four bindings. A clean lint run looks
//      identical either way; only these tests distinguish them. They
//      also pin the other half of the convention: the rule must still
//      bite for a binding that is unused by accident.
//
//   2. That the convention lives in the ROOT config. A rule scoped to
//      `packages/api/**` would also make the run clean, while letting
//      the two workspaces drift — which is the one thing the single
//      shared `eslint.config.js` exists to prevent.
//
// The snippets below are linted as text against a real file path in each
// package. The path is borrowed purely so typescript-eslint's project
// service has a program to attach the source to (it rejects any path no
// tsconfig covers); nothing about that file is under test, and its
// contents on disk are untouched.

/**
 * The workspace root, found by the file that defines it. Vitest's cwd is
 * the package when the suite runs through `npm run test --workspace` and
 * the repo when it runs through `vitest --root`, so counting directories
 * up from cwd would depend on how the suite was invoked.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "eslint.config.js"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error("no eslint.config.js found above " + process.cwd());
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot();

/** A real, tsconfig-covered file in each workspace, to borrow as a path. */
const API_FILE = resolve(repoRoot, "packages/api/src/test/lintPolicy.test.ts");
const EXTENSION_FILE = resolve(repoRoot, "packages/extension/src/lib/index.ts");

/**
 * The three shapes the `_` convention has to cover, mirroring the real
 * sites: a trailing handler parameter (`_context` in three functions), a
 * key destructured only to drop it (`_dropped` in RoundService,
 * `_omitted` in openRound.test), and a caught error the handler ignores.
 */
const INTENTIONALLY_UNUSED = `
export function handler(request: string, _context: string): string {
  return request;
}

export function withoutDoneAt(reviewer: { doneAt?: string; done: boolean }): {
  done: boolean;
} {
  const { doneAt: _dropped, ...rest } = reviewer;
  return { ...rest, done: false };
}

export function safeRead(raw: string): string {
  try {
    return raw.trim();
  } catch (_err) {
    return "";
  }
}
`;

/** The same three shapes, named as if the binding were left unused by mistake. */
const ACCIDENTALLY_UNUSED = `
export function handler(request: string, context: string): string {
  return request;
}

export function withoutDoneAt(reviewer: { doneAt?: string; done: boolean }): {
  done: boolean;
} {
  const { doneAt: dropped, ...rest } = reviewer;
  return { ...rest, done: false };
}

export function safeRead(raw: string): string {
  try {
    return raw.trim();
  } catch (err) {
    return "";
  }
}
`;

// One instance for the file: each new one rebuilds a TypeScript program.
const eslint = new ESLint({ cwd: repoRoot });

/** The `no-unused-vars` findings the repo config reports for `code`. */
async function unusedVarsIn(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (result === undefined) throw new Error(`${filePath} produced no result`);

  // A parse failure would report zero unused-vars findings and read as a
  // pass, so fail on it explicitly instead.
  const fatal = result.messages.find((message) => message.fatal === true);
  if (fatal !== undefined) {
    throw new Error(`${filePath} failed to lint: ${fatal.message}`);
  }

  return result.messages
    .filter((message) => message.ruleId === "@typescript-eslint/no-unused-vars")
    .map((message) => message.message);
}

describe("the `_`-prefixed unused-binding convention", () => {
  it("borrows a real file path in each workspace", () => {
    // Not a behaviour — a guard. If either path stops existing, the
    // project service rejects the lint and the tests below fail with a
    // parse error that says nothing about the convention.
    expect(existsSync(API_FILE), `${API_FILE} no longer exists`).toBe(true);
    expect(
      existsSync(EXTENSION_FILE),
      `${EXTENSION_FILE} no longer exists`
    ).toBe(true);
  });

  it(
    "allows a binding that is unused on purpose",
    { timeout: 30_000 },
    async () => {
      const findings = await unusedVarsIn(INTENTIONALLY_UNUSED, API_FILE);

      expect(
        findings,
        "`_`-prefixed bindings are the convention for intentionally-unused; " +
          "the linter should be taught the pattern rather than the bindings renamed"
      ).toEqual([]);
    }
  );

  it(
    "still reports a binding that is unused by accident",
    { timeout: 30_000 },
    async () => {
      const findings = await unusedVarsIn(ACCIDENTALLY_UNUSED, API_FILE);

      // The ignore pattern must narrow the rule, not switch it off — an
      // argument, a destructured variable and a caught error each still
      // count when the name carries no `_`.
      expect(findings.join("\n")).toContain("'context'");
      expect(findings.join("\n")).toContain("'dropped'");
      expect(findings.join("\n")).toContain("'err'");
    }
  );

  it("is settled repo-wide, not per package", { timeout: 30_000 }, async () => {
    // Same source, linted as the extension package: the convention comes
    // from the shared root config, so both workspaces must answer alike.
    const inExtension = await unusedVarsIn(
      INTENTIONALLY_UNUSED,
      EXTENSION_FILE
    );

    expect(
      inExtension,
      "the `^_` pattern is scoped to one workspace — the shared root " +
        "config exists so the rules cannot drift between packages"
    ).toEqual([]);
  });
});

describe("the pre-commit hook", () => {
  it("lints every workspace", () => {
    const hook = readFileSync(resolve(repoRoot, ".husky/pre-commit"), "utf8");

    // Comments describe the scoping; the commands are what runs.
    const lintCommands = hook
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("#") && line.includes("npm run lint"));

    expect(
      lintCommands.length,
      ".husky/pre-commit runs no lint step"
    ).toBeGreaterThan(0);

    for (const command of lintCommands) {
      // The hook was scoped to the extension only while packages/api
      // carried findings. With those cleaned, the scope has to come off
      // or the api can regress without the hook noticing.
      expect(
        command,
        `the hook still lints one workspace only: ${command}`
      ).not.toMatch(/--workspace/);
    }
  });
});

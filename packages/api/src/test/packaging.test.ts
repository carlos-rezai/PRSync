import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `packages/api` has been fully tested and entirely un-runnable. 130 green
// tests say the five handlers behave; nothing said the Functions host
// could start, find them, or load the file that mounts them. Each of the
// three ways that stays true is a file-level contract rather than runtime
// behaviour, which is why they are asserted here rather than discovered
// during a deploy:
//
//   1. no `host.json` — the host has nothing to run at all;
//   2. `main` pointing somewhere the composition root is not — the host
//      starts, loads whatever `main` names, registers nothing, and serves
//      404 for every route while looking perfectly healthy;
//   3. `main` naming a source path — `func start` runs compiled output.
//
// In the spirit of the bot's and the extension's `packaging.test.ts`: a
// package that would fail at deploy time goes red in the suite instead.

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

interface ApiPackageJson {
  main?: string;
  scripts?: Record<string, string>;
}

interface HostJson {
  version?: string;
  extensionBundle?: { id?: string; version?: string };
}

function readPackageJson(): ApiPackageJson {
  return JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8")
  ) as ApiPackageJson;
}

describe("the Functions host", () => {
  it("has a host.json pinning the runtime and its extension bundle", () => {
    const hostJsonPath = resolve(packageRoot, "host.json");
    expect(
      existsSync(hostJsonPath),
      "packages/api has no host.json, so the Functions host has nothing to run"
    ).toBe(true);

    const hostJson = JSON.parse(readFileSync(hostJsonPath, "utf8")) as HostJson;

    // v2.0 is the runtime generation the v4 programming model requires;
    // the extension bundle is what supplies the HTTP binding the handlers
    // are registered against, and an unpinned range is a deploy that
    // behaves differently from the last one for no reason in the diff.
    expect(hostJson.version).toBe("2.0");
    expect(hostJson.extensionBundle?.id).toBe(
      "Microsoft.Azure.Functions.ExtensionBundle"
    );
    expect(hostJson.extensionBundle?.version).toBeTruthy();
  });

  it("loads the composition root, not the handler modules", () => {
    // `main` is the whole of function discovery in the v4 model: the host
    // loads exactly what it names and registers whatever that file
    // registered. The pre-registration value here was a recursive glob
    // over the handler modules — which contain no `app.http()` call, so a
    // host loading them comes up with no functions and no error.
    const main = readPackageJson().main ?? "";

    expect(main, "packages/api declares no main, so the host loads nothing").toBeTruthy();
    expect(
      main,
      "main still globs the handler modules; none of them registers anything"
    ).not.toContain("*");

    // Built output, not source: `func start` runs what `npm run build`
    // emitted, and `tsc` puts `src/index.ts` at `dist/index.js` under
    // this package's rootDir/outDir.
    expect(
      existsSync(resolve(packageRoot, "src/index.ts")),
      "there is no src/index.ts for the build to emit as the entry point"
    ).toBe(true);
    expect(main).toBe("dist/index.js");
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HttpFunctionOptions } from "@azure/functions";
import {
  cancelRoundOptions,
  editLabelOptions,
  getCurrentRoundOptions,
  openRoundOptions,
  toggleDoneOptions,
} from "../functions";

// The seam Feature 2 already committed to and Feature 1 never registered.
//
// `packages/extension`'s `ApiClient` has been calling five routes since
// issue #8. `packages/api` has five handler factories that no runtime
// mounts anywhere. Both packages' suites are green and have been all
// along, because nothing in either one asserts that the paths agree —
// they meet for the first time over HTTP, in a browser, at which point a
// mismatch is a 404 with no failing test anywhere.
//
// So the contract is asserted against the ACTUAL client source rather
// than a table copied out of it. A table would pin the api half and let
// the extension drift away from it silently, which is the same failure
// with an extra step. Reading the source is the same move as the bot's
// `layerPolicy.test.ts` and the extension's `packaging.test.ts`: a
// cross-file contract caught in the suite rather than in review.
//
// This does mean the extraction below is coupled to how `ApiClient.ts` is
// written, so both contract tests start from the same guard: five calls
// were found and every one resolved to a real path. Without it, an
// extraction that quietly stopped matching would report a passing
// contract over an empty list.

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

const API_CLIENT = resolve(
  repoRoot,
  "packages/extension/src/api/ApiClient/ApiClient.ts"
);

type RegistrationOptions = Omit<HttpFunctionOptions, "handler">;

/** The five entry points, as the composition root will register them. */
const REGISTERED: { name: string; options: RegistrationOptions }[] = [
  { name: "getCurrentRound", options: getCurrentRoundOptions },
  { name: "openRound", options: openRoundOptions },
  { name: "toggleDone", options: toggleDoneOptions },
  { name: "editLabel", options: editLabelOptions },
  { name: "cancelRound", options: cancelRoundOptions },
];

/** One HTTP call the panel makes, as a concrete method and path. */
interface ClientCall {
  method: string;
  path: string;
}

/** A well-formed PR key, whose `:` separators must survive as one segment. */
const PR_KEY = "6f5e4d3c:aabbccdd:42";
const ROUND_NUMBER = "7";

function clientSource(): string {
  expect(
    existsSync(API_CLIENT),
    `${API_CLIENT} is missing — this test can no longer see what the panel calls`
  ).toBe(true);
  return readFileSync(API_CLIENT, "utf8");
}

/**
 * The path template the client's `rounds(prKey)` helper returns, so a call
 * written as `` `${rounds(prKey)}/current` `` can be read as the path it
 * actually produces.
 */
function roundsTemplate(source: string): string {
  const match = /function rounds\([^)]*\)[^{]*\{\s*return\s+`([^`]*)`/.exec(
    source
  );
  expect(
    match,
    "ApiClient no longer builds its paths through a `rounds(prKey)` helper — " +
      "the extraction here needs updating before it can judge anything"
  ).not.toBe(null);
  return (match as RegExpExecArray)[1] as string;
}

/**
 * Substitutes every `${...}` in a path template for a concrete segment, so
 * the result can be matched against a route template. `prKey` is
 * substituted with a real key including its `:` separators, because the
 * client URL-encoding it into a single segment is part of the contract:
 * an unencoded key would split the path and reach no route at all.
 */
function concrete(template: string): string {
  return template
    .replace(/\$\{encodeURIComponent\(prKey\)\}/g, encodeURIComponent(PR_KEY))
    .replace(/\$\{prKey\}/g, PR_KEY)
    .replace(/\$\{roundNumber\}/g, ROUND_NUMBER)
    .replace(/\$\{[^}]*\}/g, "unresolved");
}

/**
 * Every call the client makes, as `{ method, path }`.
 *
 * Each `send(` is read up to the next one, which is the window its own
 * `method:` can appear in; a call with none is a GET, exactly as `fetch`
 * treats an absent method. `send`'s own declaration is passed over,
 * because its first argument is a parameter list rather than a path.
 */
function extractClientCalls(): ClientCall[] {
  const source = clientSource();
  const rounds = roundsTemplate(source);

  const starts: number[] = [];
  for (
    let index = source.indexOf("send(");
    index !== -1;
    index = source.indexOf("send(", index + 1)
  ) {
    starts.push(index);
  }

  const calls: ClientCall[] = [];
  for (const [position, start] of starts.entries()) {
    const window = source.slice(start, starts[position + 1] ?? source.length);

    // The path is the first argument: a template literal, or the bare
    // `rounds(prKey)` helper when the path is the collection itself.
    const firstArgument = /^send\(\s*(?:`([^`]*)`|rounds\([^)]*\))/.exec(
      window
    );
    if (firstArgument === null) continue;

    const template = firstArgument[1] ?? "${rounds(prKey)}";
    const method = /\bmethod:\s*"([A-Z]+)"/.exec(window)?.[1] ?? "GET";

    calls.push({
      method,
      path: concrete(template.replace(/\$\{rounds\([^)]*\)\}/g, rounds)),
    });
  }
  return calls;
}

/**
 * The extracted calls, having first established that the extraction still
 * works and that every handler exposes the options to judge it against.
 * Both contract tests go through here so that neither can pass vacuously.
 */
function clientCalls(): ClientCall[] {
  for (const { name, options } of REGISTERED) {
    expect(
      options,
      `${name} exports no registration options, so nothing can mount it`
    ).toBeDefined();
  }

  const calls = extractClientCalls();
  expect(
    calls.map((call) => `${call.method} ${call.path}`),
    "the extraction no longer sees what ApiClient calls"
  ).toHaveLength(5);

  for (const call of calls) {
    expect(
      call.path,
      `${call.path} was not resolved to a real path`
    ).not.toContain("unresolved");
    expect(call.path).toMatch(/^\/api\/prs\//);
  }
  return calls;
}

/** A route template (`prs/{prKey}/rounds/{n}`) as a matcher over a path. */
function routeMatcher(prefix: string, route: string): RegExp {
  const pattern = route
    .split("/")
    .map((segment) =>
      /^\{.+\}$/.test(segment)
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/");
  return new RegExp(`^/${prefix}/${pattern}$`);
}

/** Whether this registration serves that call. */
function serves(
  options: RegistrationOptions,
  prefix: string,
  call: ClientCall
): boolean {
  return (
    routeMatcher(prefix, options.route ?? "").test(call.path) &&
    (options.methods ?? []).some((method) => method === call.method)
  );
}

/**
 * The prefix the Functions host mounts every route under. Absent from
 * `host.json` means the host's own default, which is `api` — the same
 * `/api` the client's paths are written with.
 */
function routePrefix(): string {
  const hostJsonPath = resolve(packageRoot, "host.json");
  expect(
    existsSync(hostJsonPath),
    "packages/api has no host.json, so the Functions host has nothing to run"
  ).toBe(true);

  const hostJson = JSON.parse(readFileSync(hostJsonPath, "utf8")) as {
    extensions?: { http?: { routePrefix?: string } };
  };
  return hostJson.extensions?.http?.routePrefix ?? "api";
}

describe("the panel's API contract", () => {
  it("mounts every call the panel makes, at its method", () => {
    const prefix = routePrefix();

    for (const call of clientCalls()) {
      const matched = REGISTERED.filter(({ options }) =>
        serves(options, prefix, call)
      );

      expect(
        matched.map(({ name }) => name),
        `the panel calls ${call.method} ${call.path}, which no registered handler serves`
      ).toHaveLength(1);
    }
  });

  it("mounts nothing the panel never calls", () => {
    // The other direction, and the one a hand-written table of expected
    // routes would miss: a handler mounted at a path with a typo still
    // serves every call the panel makes — because it serves none of them,
    // and its twin does. This is what notices the orphan.
    const prefix = routePrefix();
    const calls = clientCalls();

    for (const { name, options } of REGISTERED) {
      expect(
        calls.some((call) => serves(options, prefix, call)),
        `${name} is mounted at ${(options.methods ?? []).join("/")} ${options.route}, which the panel never calls`
      ).toBe(true);
    }
  });

  it("agrees with the client about the route prefix", () => {
    // The client's paths are written with a literal `/api`. The host
    // mounts every route under a prefix that is configurable and defaults
    // to `api` — so the two can disagree without either file looking
    // wrong on its own.
    expect(routePrefix()).toBe("api");
  });
});

describe("the composition root", () => {
  it("registers every one of the five handlers", () => {
    // Read rather than imported: `src/index.ts` reads the environment and
    // throws at load when it is not configured, which is the behaviour
    // wanted at host start and exactly what makes it unimportable here.
    const source = readFileSync(resolve(packageRoot, "src/index.ts"), "utf8");

    expect(
      source.match(/\bapp\.http\(/g) ?? [],
      "src/index.ts does not register five HTTP handlers — the factories below it are unreachable"
    ).toHaveLength(5);

    for (const { name } of REGISTERED) {
      expect(
        source,
        `src/index.ts never mounts ${name}, so nothing serves its route`
      ).toContain(`${name}Options`);
    }
  });
});

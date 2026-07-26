import * as React from "react";
import { vi, type Mock } from "vitest";
import { render, type RenderResult } from "@testing-library/react";
import { App } from "../../App/App";
import type { SdkClient } from "../../sdk";
import type { ApiClient } from "../../api";
import type { AdoClient, AdoPullRequest } from "../../ado";
import { PR_KEY_PARTS, makeAdoPullRequest } from "./fixtures";

// One fake per injected client, and the render helper that wires all
// three into the panel. Dependency injection is this package's testing
// seam (design log 02, Q14): tests pass these fakes, boot passes the real
// host-backed clients. Nothing here mocks a module.
//
// Two rules make these different from the ad-hoc fakes they replace:
//
// 1. Each fake implements its interface COMPLETELY. `Faked<T>` maps an
//    interface onto the same shape with every method a typed `vi.fn`, and
//    each factory's return value is assignable to the real interface — so
//    adding a method to `ApiClient` is a compile error in one place here,
//    rather than a `TypeError: x is not a function` in whichever test
//    happens to reach it. There are no type assertions in this file, by
//    design: a fake that does not satisfy its interface must not compile.
//
// 2. A method a test did not stub REJECTS with a message saying so, rather
//    than being absent. "toggleDone was called but not stubbed in this
//    test" is a diagnosis; `x is not a function` is a puzzle.
//
// Reads (`sdk.getUser`, `ado.getPullRequest`) get ordinary working
// defaults instead, because there is an honest default state to read —
// see `makeAdo` below. Only the PRSync mutations, where any default would
// misrepresent what the test set up, reject.

/**
 * The same shape as `T`, with every method replaced by a `vi.fn` typed to
 * that method's signature. Mapped-type members are properties rather than
 * methods, which is also what lets a test assert on `api.toggleDone`
 * directly without tripping `@typescript-eslint/unbound-method`.
 */
export type Faked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K];
};

/**
 * The default for any client method a test did not stub. Rejects rather
 * than resolving something plausible: a test that reaches for a call it
 * never set up is a test whose intent and behaviour have diverged, and it
 * should say which call.
 */
function notStubbed(client: string, method: string): () => Promise<never> {
  return () =>
    Promise.reject(
      new Error(`${client}.${method}() was called but not stubbed in this test`)
    );
}

/**
 * The ADO host seam. `getUser` and `prKeyParts` are the panel's ambient
 * context rather than anything a test drives, so they answer for real;
 * `resize` records the host's "size me to my content" calls.
 */
export function makeSdk(
  viewerAdoId: string,
  overrides: Partial<Faked<SdkClient>> = {}
): Faked<SdkClient> {
  return {
    getUser: vi.fn(() => ({ id: viewerAdoId, displayName: "Viewer" })),
    prKeyParts: vi.fn(() => PR_KEY_PARTS),
    getAccessToken: vi.fn(() => Promise.resolve("fake-token")),
    resize: vi.fn(),
    ...overrides,
  };
}

/**
 * The PRSync API client. Every method is present; every one a test does
 * not stub rejects by name.
 */
export function makeApi(
  overrides: Partial<Faked<ApiClient>> = {}
): Faked<ApiClient> {
  return {
    getCurrentRound: vi.fn(notStubbed("api", "getCurrentRound")),
    toggleDone: vi.fn(notStubbed("api", "toggleDone")),
    openRound: vi.fn(notStubbed("api", "openRound")),
    editLabel: vi.fn(notStubbed("api", "editLabel")),
    cancelRound: vi.fn(notStubbed("api", "cancelRound")),
    ...overrides,
  };
}

/**
 * Azure DevOps's own PR read. Unlike the API fake this has a working
 * default, because "the PR as it stands" is a real state with an honest
 * answer — `makeAdoPullRequest`'s author-created PR with one eligible
 * reviewer. Tests that turn on a different live PR pass one.
 */
export function makeAdo(
  pullRequest: AdoPullRequest = makeAdoPullRequest(),
  overrides: Partial<Faked<AdoClient>> = {}
): Faked<AdoClient> {
  return {
    getPullRequest: vi.fn(() => Promise.resolve(pullRequest)),
    ...overrides,
  };
}

/**
 * Mounts the panel with all three clients injected. The parameters are
 * typed as the REAL interfaces, so passing a fake is itself the proof
 * that the fake satisfies its contract.
 */
export function renderApp(
  sdk: SdkClient,
  api: ApiClient,
  ado: AdoClient
): RenderResult {
  return render(<App sdk={sdk} api={api} ado={ado} />);
}

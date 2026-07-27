import { vi, type Mock } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import type { IdentityResolver, ResolvedIdentity } from "../../services";
import { PR_KEY } from "./fixtures";

// The fakes every `functions/` test needs: an inbound request, the
// invocation context, and the identity seam. One copy, mirroring
// `packages/extension/src/test/fixtures/fakes.tsx`, which each of the
// five entry-point tests used to carry its own near-identical version of.
//
// Two rules shape what is here, and both are why the fakes look the way
// they do rather than being the shortest thing that runs:
//
// 1. Nothing is `async` purely to look like the thing it fakes. A body
//    that awaits nothing returns a promise instead — an `async` keyword
//    over a synchronous body is a claim the function does not honour.
//
// 2. Anything a test asserts *on* is exposed as a PROPERTY, never read
//    back off the faked object as a method. `context.spies.error` is a
//    mock; `context.error` is a method reference torn off its receiver,
//    which is a real footgun (`this` is lost) and not something a fake
//    should teach.
//
// The `Faked<T>` seam then keeps a fake honest against its interface:
// adding a method to `IdentityResolver` becomes a compile error here,
// once, rather than a `TypeError` in whichever test reaches it.

/**
 * The same shape as `T`, with every method replaced by a `vi.fn` typed to
 * that method's signature. The members are properties rather than
 * methods, which is also what lets a test assert on `identity.resolve`
 * directly without tearing a method off its receiver.
 */
export type Faked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K];
};

/**
 * The identity seam, resolving every request to `adoId`. Handlers never
 * authorize for themselves — they pass the resolved caller through — so
 * a test that wants 401 calls `resolve.mockResolvedValue(null)`.
 */
export function makeIdentityResolver(adoId: string): Faked<IdentityResolver> {
  return {
    resolve: vi.fn((): Promise<ResolvedIdentity | null> =>
      Promise.resolve({ adoId })
    ),
  };
}

/** What a handler may write to during an invocation. */
export interface ContextSpies {
  log: Mock<(...args: unknown[]) => void>;
  trace: Mock<(...args: unknown[]) => void>;
  debug: Mock<(...args: unknown[]) => void>;
  info: Mock<(...args: unknown[]) => void>;
  warn: Mock<(...args: unknown[]) => void>;
  error: Mock<(...args: unknown[]) => void>;
}

/**
 * An `InvocationContext` a handler can be called with, whose log spies
 * are also reachable as plain properties under `spies` — `ctx.spies.error`
 * rather than `ctx.error`.
 */
export type TestInvocationContext = InvocationContext & {
  readonly spies: ContextSpies;
};

/**
 * The invocation context. The assertion is real work rather than
 * ceremony: `InvocationContext` also carries `extraInputs`, `extraOutputs`
 * and `options`, none of which an HTTP handler touches and none of which
 * has an honest fake. It is made once, here, instead of in every test.
 */
export function makeContext(): TestInvocationContext {
  const spies: ContextSpies = {
    log: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    invocationId: "test",
    ...spies,
    spies,
  } as unknown as TestInvocationContext;
}

/**
 * Everything the handler wrote to `context.error`, flattened into one
 * string. Both PII-safety tests ask the same question of it — that the
 * correlation key is in there and no token or email is.
 */
export function loggedErrors(context: TestInvocationContext): string {
  return context.spies.error.mock.calls
    .flat()
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
}

export interface RequestOptions {
  /** Decorative — no handler reads it; it makes a failure dump legible. */
  method?: string;
  /** Decorative, as above. */
  url?: string;
  /** The route bindings. This is where `prKey` and `n` come from. */
  params?: Record<string, string>;
  /** Serialized for `text()` and handed back verbatim from `json()`. */
  body?: unknown;
  /** A raw payload for the oversized-body cases, where no object would do. */
  rawBody?: string;
  headers?: Record<string, string>;
}

/**
 * An inbound request. Handlers read exactly three things off it — the
 * route params, the headers, and the body — so those are the three the
 * fake takes seriously.
 */
export function makeRequest(options: RequestOptions = {}): HttpRequest {
  const {
    method = "POST",
    params = { prKey: PR_KEY },
    url = `http://localhost/api/prs/${params.prKey}`,
    body,
    rawBody,
    headers = {},
  } = options;
  const raw = rawBody ?? (body === undefined ? "" : JSON.stringify(body));

  return {
    method,
    url,
    params,
    query: new URLSearchParams(),
    headers: new Headers(headers),
    // Not `async`: neither reads anything, and a request with no body
    // must reject the way the runtime's would.
    json: () =>
      body === undefined
        ? Promise.reject(new Error("no json body"))
        : Promise.resolve(body),
    text: () => Promise.resolve(raw),
  } as unknown as HttpRequest;
}

// The fakes every layer's tests drive their subject through, mirroring
// `packages/api/src/test/fixtures/fakes.ts`. Domain values live next door
// in `fixtures.ts`.
//
// Two rules shape what is here, carried over from the api's fakes:
//
// 1. Nothing is `async` purely to look like the thing it fakes. A body
//    that awaits nothing returns a promise instead.
//
// 2. Anything a test asserts *on* is exposed as a PROPERTY, never read
//    back off the faked object as a method.
//
// Every type here is imported with `import type` on purpose: these are
// contracts the modules under test will declare, and a value import would
// make the fixture itself the thing that fails to load.

import { vi, type Mock } from "vitest";
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import type { AdaptiveCard, ConversationRef, TeamsIdentity } from "../../lib";
import type { NotificationDispatcher } from "../../services";
import type { TeamsIdentityRepository } from "../../storage";
import type { MessagingEndpoint, TeamsSender } from "../../teams";

/**
 * The same shape as `T`, with every method replaced by a `vi.fn` typed to
 * that method's signature — so adding a method to an interface becomes a
 * compile error here, once, rather than a `TypeError` in whichever test
 * reaches it.
 */
export type Faked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K];
};

/** A repository a test can inspect as well as drive. */
export interface InMemoryTeamsIdentityRepository extends TeamsIdentityRepository {
  /**
   * The rows exactly as they were written, keyed by whatever key the
   * caller passed. Exposed so a test can see that two spellings of one
   * address landed on ONE row rather than two — a fact `get` alone
   * cannot distinguish from "the second write happened to win".
   */
  readonly rows: Map<string, TeamsIdentity>;
}

/**
 * Table Storage in a Map. Point access only, by exact key, because that
 * is the only access the real repository is allowed — a fake that
 * supported scanning would let a test pass against a repository the
 * product forbids.
 */
export function makeIdentityRepository(): InMemoryTeamsIdentityRepository {
  const rows = new Map<string, TeamsIdentity>();
  return {
    rows,
    upsert(identity: TeamsIdentity): Promise<void> {
      rows.set(identity.email, { ...identity });
      return Promise.resolve();
    },
    get(email: string): Promise<TeamsIdentity | null> {
      const row = rows.get(email);
      return Promise.resolve(row === undefined ? null : { ...row });
    },
    delete(email: string): Promise<void> {
      rows.delete(email);
      return Promise.resolve();
    },
  };
}

/** One DM the bot handed to Teams: who it went to, and what it said. */
export interface RecordedSend {
  conversationReference: ConversationRef;
  card: AdaptiveCard;
}

/** A sender a test can read back, as well as drive. */
export interface RecordingTeamsSender extends TeamsSender {
  /**
   * The DMs, in the order they were sent. A property rather than a spy's
   * call list because "who was messaged, and with what" is the entire
   * observable outcome of a dispatch — it should read like the fact it
   * is, not like an assertion about a mock.
   */
  readonly sends: RecordedSend[];
}

/**
 * The seam that keeps Bot Framework out of the dispatcher's test. The
 * real sender opens a proactive 1:1 conversation and posts a card
 * attachment; this one writes down that it was asked to, which is the
 * whole reason the port is a single narrow operation.
 */
export function makeTeamsSender(): RecordingTeamsSender {
  const sends: RecordedSend[] = [];
  return {
    sends,
    send(conversationReference: ConversationRef, card: AdaptiveCard): Promise<void> {
      sends.push({ conversationReference, card });
      return Promise.resolve();
    },
  };
}

/**
 * The dispatcher, as the queue-triggered function sees it. The function's
 * whole job is to hand one message over, so the fake only has to be able
 * to say what it was handed.
 */
export function makeNotificationDispatcher(): Faked<NotificationDispatcher> {
  return {
    dispatch: vi.fn((): Promise<void> => Promise.resolve()),
  };
}

/**
 * The Bot Framework messaging endpoint, as the HTTP function sees it. The
 * function's whole job is to hand the request over and hand the response
 * back, so the fake only has to be able to say what it returned.
 */
export function makeMessagingEndpoint(
  response: HttpResponseInit = { status: 200 }
): Faked<MessagingEndpoint> {
  return {
    process: vi.fn((): Promise<HttpResponseInit> => Promise.resolve(response)),
  };
}

/** What a handler may write to during an invocation. */
export interface ContextSpies {
  log: Mock<(...args: unknown[]) => void>;
  warn: Mock<(...args: unknown[]) => void>;
  error: Mock<(...args: unknown[]) => void>;
}

/**
 * An `InvocationContext` a handler can be called with, whose log spies are
 * also reachable as plain properties under `spies` — `ctx.spies.error`
 * rather than `ctx.error`, which would be a method torn off its receiver.
 */
export type TestInvocationContext = InvocationContext & {
  readonly spies: ContextSpies;
};

/**
 * The invocation context. Asserted rather than hand-rolled per test:
 * `InvocationContext` also carries `extraInputs`, `extraOutputs` and
 * `options`, none of which an HTTP handler touches and none of which has
 * an honest fake.
 */
export function makeContext(): TestInvocationContext {
  const spies: ContextSpies = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    invocationId: "test",
    ...spies,
    spies,
  } as unknown as TestInvocationContext;
}

export interface RequestOptions {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * An inbound HTTP request. The messaging function reads nothing off it —
 * it forwards the whole thing to the adapter, which is what has to
 * validate the Bot Framework JWT — so the fake exists to be identifiable,
 * not to be parsed.
 */
export function makeRequest(options: RequestOptions = {}): HttpRequest {
  const {
    method = "POST",
    url = "http://localhost/api/messages",
    body = { type: "message" },
    headers = { authorization: "Bearer bot-framework-token" },
  } = options;

  return {
    method,
    url,
    params: {},
    query: new URLSearchParams(),
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as HttpRequest;
}

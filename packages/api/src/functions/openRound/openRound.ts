import type {
  HttpFunctionOptions,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import { isValidPrKey } from "../../lib";
import {
  RoundService,
  RoundServiceError,
  type OpenRoundInput,
  type IdentityResolver,
} from "../../services";

// Thin HTTP entry point for POST /api/prs/{prKey}/rounds. The layer does
// exactly three things: reject malformed input at the boundary (before
// any service/storage call), resolve the caller's identity via the
// IdentityResolver seam (401 when it yields nothing), and map the
// service result/errors to HTTP. No business logic lives here.
//
// The recorded author identity comes ONLY from the resolved token — the
// body carries the author's name/email as inert display/Teams data but
// has NO author `adoId` field (reject-unknown), so authoring a round as
// someone else is inexpressible. Tokens and reviewer/author emails never
// reach the logs; correlation is on the PR key.

/**
 * Where the composition root mounts this handler. It lives beside the
 * behaviour it serves rather than only in `src/index.ts`, because a
 * factory nothing registers is dead code every test below still passes on.
 *
 * Anonymous of necessity, and the same reasoning as the bot's
 * `/api/messages`: the only caller is a browser-side panel, so a Function
 * key would have to ship inside the extension bundle, which makes it not a
 * secret. This is NOT an unauthenticated endpoint — every handler resolves
 * the caller's ADO bearer token through the `IdentityResolver` seam and
 * answers 401 when it yields nothing — but the two facts have to be read
 * together, which is why the level is pinned here rather than left to a
 * deployment setting nobody diffs.
 */
export const openRoundOptions: Omit<HttpFunctionOptions, "handler"> = {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "prs/{prKey}/rounds",
};

// Reject bodies larger than this before parsing — a cheap DoS guard and
// a hard cap well above any legitimate reviewer list.
const MAX_BODY_BYTES = 1_000_000;

const reviewerSchema = z.strictObject({
  adoId: z.string(),
  email: z.string(),
  displayName: z.string(),
  isRequired: z.boolean(),
  isContainer: z.boolean(),
});

const openRoundBodySchema = z.strictObject({
  phase: z.enum(["spec", "implementation"]),
  reviewers: z.array(reviewerSchema),
  prTitle: z.string(),
  prUrl: z.string(),
  // Display/Teams data only — never an adoId. The authoritative author
  // identity is the resolved caller's adoId (reject-unknown drops any
  // attempt to smuggle one in via the body).
  author: z.strictObject({
    name: z.string(),
    email: z.string(),
  }),
  label: z.string().optional(),
});

export function makeOpenRoundHandler(
  service: RoundService,
  identity: IdentityResolver
) {
  return async function openRound(
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> {
    const prKey = request.params.prKey ?? "";
    if (!isValidPrKey(prKey)) {
      return { status: 400, jsonBody: { error: "Malformed PR key." } };
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return { status: 413, jsonBody: { error: "Request body too large." } };
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON body." } };
    }

    const parsed = openRoundBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return { status: 400, jsonBody: { error: "Invalid request body." } };
    }

    const caller = await identity.resolve(request);
    if (caller === null) {
      return { status: 401, jsonBody: { error: "Unauthenticated." } };
    }

    try {
      const input: OpenRoundInput = {
        phase: parsed.data.phase,
        reviewers: parsed.data.reviewers,
        prTitle: parsed.data.prTitle,
        prUrl: parsed.data.prUrl,
        // Author identity is the resolved caller — never the body.
        callerAdoId: caller.adoId,
        author: {
          adoId: caller.adoId,
          name: parsed.data.author.name,
          email: parsed.data.author.email,
        },
        label: parsed.data.label,
      };
      const round = await service.openRound(prKey, input);
      return { status: 201, jsonBody: round };
    } catch (error) {
      if (error instanceof RoundServiceError) {
        const status = error.code === "ROUND_ALREADY_OPEN" ? 409 : 422;
        return { status, jsonBody: { error: error.code } };
      }
      // Correlate on the PR key only — never the bearer token or any
      // reviewer/author email.
      context.error(`openRound failed [pr=${prKey}]`, error);
      throw error;
    }
  };
}

import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import { isValidPrKey } from "../lib";
import { RoundService, RoundServiceError } from "../services/RoundService";
import type { IdentityResolver } from "../services/IdentityResolver";

// Thin HTTP entry point for PATCH /api/prs/{prKey}/rounds/{n}/done. The
// layer validates the boundary (prKey, round number, and a `{ done }`
// body carrying NO reviewer id — reject-unknown), resolves the caller's
// identity via the IdentityResolver seam (401 when it yields nothing),
// calls the service, and maps its result/errors to HTTP. The toggle
// target is *always* the resolved caller — the function never authorizes
// against the body, and the 403 "not a snapshotted reviewer" check is
// the service's job.

// Reject bodies larger than this before parsing — a cheap DoS guard.
const MAX_BODY_BYTES = 1_000_000;

// Reject-unknown: only `done` is accepted, so no reviewer-id field can
// smuggle in and target someone else.
const toggleDoneBodySchema = z.strictObject({
  done: z.boolean(),
});

export function makeToggleDoneHandler(
  service: RoundService,
  identity: IdentityResolver
) {
  return async function toggleDone(
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> {
    const prKey = request.params.prKey ?? "";
    if (!isValidPrKey(prKey)) {
      return { status: 400, jsonBody: { error: "Malformed PR key." } };
    }

    const roundNumber = Number(request.params.n);
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      return { status: 400, jsonBody: { error: "Malformed round number." } };
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

    const parsed = toggleDoneBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return { status: 400, jsonBody: { error: "Invalid request body." } };
    }

    const caller = await identity.resolve(request);
    if (caller === null) {
      return { status: 401, jsonBody: { error: "Unauthenticated." } };
    }

    try {
      const round = await service.toggleDone(prKey, {
        roundNumber,
        callerAdoId: caller.adoId,
        done: parsed.data.done,
      });
      return { status: 200, jsonBody: round };
    } catch (error) {
      if (error instanceof RoundServiceError) {
        return {
          status: statusForError(error),
          jsonBody: { error: error.code },
        };
      }
      // Correlate on the PR key + round number only — never the bearer
      // token or any reviewer email.
      context.error(
        `toggleDone failed [pr=${prKey} round=${roundNumber}]`,
        error
      );
      throw error;
    }
  };
}

function statusForError(error: RoundServiceError): number {
  switch (error.code) {
    case "NOT_A_REVIEWER":
      return 403;
    case "ROUND_NOT_OPEN":
      return 409;
    case "CONCURRENCY_EXHAUSTED":
      return 503;
    default:
      return 500;
  }
}

import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { isValidPrKey } from "../lib";
import {
  RoundService,
  RoundServiceError,
  type IdentityResolver,
} from "../services";

// Thin HTTP entry point for POST /api/prs/{prKey}/rounds/{n}/cancel. The
// layer validates the boundary (prKey, round number — no body), resolves
// the caller's identity via the IdentityResolver seam (401 when it yields
// nothing), calls the service, and maps its result/errors to HTTP. The
// author-only 403 (NOT_AUTHOR) check is the service's job — the function
// passes the resolved caller through and never authorizes itself.

export function makeCancelRoundHandler(
  service: RoundService,
  identity: IdentityResolver
) {
  return async function cancelRound(
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> {
    const prKey = request.params.prKey ?? "";
    if (!isValidPrKey(prKey)) {
      return { status: 400, jsonBody: { error: "Malformed PR key." } };
    }

    const roundNumber = Number(request.params.n);
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      return { status: 400, jsonBody: { error: "Malformed round number." } };
    }

    const caller = await identity.resolve(request);
    if (caller === null) {
      return { status: 401, jsonBody: { error: "Unauthenticated." } };
    }

    try {
      const round = await service.cancelRound(prKey, {
        roundNumber,
        callerAdoId: caller.adoId,
      });
      return { status: 200, jsonBody: round };
    } catch (error) {
      if (error instanceof RoundServiceError) {
        return {
          status: statusForError(error),
          jsonBody: { error: error.code },
        };
      }
      throw error;
    }
  };
}

function statusForError(error: RoundServiceError): number {
  switch (error.code) {
    case "NOT_AUTHOR":
      return 403;
    case "ROUND_NOT_OPEN":
      return 409;
    case "CONCURRENCY_EXHAUSTED":
      return 503;
    default:
      return 500;
  }
}

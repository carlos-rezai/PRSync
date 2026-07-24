import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { isValidPrKey } from "../lib";
import type { RoundService } from "../services/RoundService";
import type { IdentityResolver } from "../services/IdentityResolver";

// Thin HTTP entry point for GET /api/prs/{prKey}/rounds/current. Returns
// the latest round of any status (200), an empty 204 when the PR has
// never had a round, or 400 for a malformed key — validated before any
// storage call. This read serves reviewer emails (PII), so it requires a
// valid ADO bearer token exactly like the mutating endpoints: an
// unresolved identity is 401 BEFORE any storage access.

export function makeGetCurrentRoundHandler(
  service: RoundService,
  identity: IdentityResolver
) {
  return async function getCurrentRound(
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> {
    const prKey = request.params.prKey ?? "";
    if (!isValidPrKey(prKey)) {
      return { status: 400, jsonBody: { error: "Malformed PR key." } };
    }

    const caller = await identity.resolve(request);
    if (caller === null) {
      return { status: 401, jsonBody: { error: "Unauthenticated." } };
    }

    const round = await service.getCurrentRound(prKey);
    if (round === null) {
      return { status: 204 };
    }
    return { status: 200, jsonBody: round };
  };
}

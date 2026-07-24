import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { isValidPrKey } from "../lib/prKey";
import type { RoundService } from "../services/RoundService";

// Thin HTTP entry point for GET /api/prs/{prKey}/rounds/current. Returns
// the latest round of any status (200), an empty 204 when the PR has
// never had a round, or 400 for a malformed key — validated before any
// storage call.

export function makeGetCurrentRoundHandler(service: RoundService) {
  return async function getCurrentRound(
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> {
    const prKey = request.params.prKey ?? "";
    if (!isValidPrKey(prKey)) {
      return { status: 400, jsonBody: { error: "Malformed PR key." } };
    }

    const round = await service.getCurrentRound(prKey);
    if (round === null) {
      return { status: 204 };
    }
    return { status: 200, jsonBody: round };
  };
}

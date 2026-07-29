import type {
  HttpFunctionOptions,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { isValidPrKey } from "../../lib";
import type { RoundService, IdentityResolver } from "../../services";

// Thin HTTP entry point for GET /api/prs/{prKey}/rounds/current. Returns
// the latest round of any status (200), an empty 204 when the PR has
// never had a round, or 400 for a malformed key — validated before any
// storage call. This read serves reviewer emails (PII), so it requires a
// valid ADO bearer token exactly like the mutating endpoints: an
// unresolved identity is 401 BEFORE any storage access.

/**
 * Where the composition root mounts this handler — see the note on
 * `openRoundOptions` for why the auth level is anonymous and why that is
 * not the same as unauthenticated.
 *
 * `current` and `{n}` are siblings under `rounds/`. They never collide,
 * because this is the only GET of the five.
 */
export const getCurrentRoundOptions: Omit<HttpFunctionOptions, "handler"> = {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "prs/{prKey}/rounds/current",
};

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

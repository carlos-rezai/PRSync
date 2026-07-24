import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import { isValidPrKey } from "../lib/prKey";
import { RoundService, RoundServiceError } from "../services/RoundService";
import type { IdentityResolver } from "../services/IdentityResolver";

// Thin HTTP entry point for PATCH /api/prs/{prKey}/rounds/{n}. The layer
// validates the boundary (prKey, round number, and a `{ label }` body —
// reject-unknown), resolves the caller's identity via the IdentityResolver
// seam (401 when it yields nothing), calls the service, and maps its
// result/errors to HTTP. The author-only 403 (NOT_AUTHOR) check is the
// service's job — the function passes the resolved caller through.

// Reject bodies larger than this before parsing — a cheap DoS guard.
const MAX_BODY_BYTES = 1_000_000;

// Reject-unknown: only `label` is accepted, so no other field (e.g.
// `status`) can smuggle in and mutate state the edit must not touch.
const editLabelBodySchema = z.strictObject({
  label: z.string(),
});

export function makeEditLabelHandler(
  service: RoundService,
  identity: IdentityResolver
) {
  return async function editLabel(
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

    const parsed = editLabelBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return { status: 400, jsonBody: { error: "Invalid request body." } };
    }

    const caller = await identity.resolve(request);
    if (caller === null) {
      return { status: 401, jsonBody: { error: "Unauthenticated." } };
    }

    try {
      const round = await service.editLabel(prKey, {
        roundNumber,
        callerAdoId: caller.adoId,
        label: parsed.data.label,
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

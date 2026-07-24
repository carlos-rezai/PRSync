import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import { isValidPrKey } from "../lib/prKey";
import {
  RoundService,
  RoundServiceError,
  type OpenRoundInput,
} from "../services/RoundService";

// Thin HTTP entry point for POST /api/prs/{prKey}/rounds. The layer does
// exactly three things: reject malformed input at the boundary (before
// any service/storage call), call the service, and map its result/errors
// to HTTP. No business logic lives here.

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
  author: z.strictObject({
    adoId: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  label: z.string().optional(),
});

export function makeOpenRoundHandler(service: RoundService) {
  return async function openRound(
    request: HttpRequest,
    _context: InvocationContext
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

    try {
      const input: OpenRoundInput = parsed.data;
      const round = await service.openRound(prKey, input);
      return { status: 201, jsonBody: round };
    } catch (error) {
      if (error instanceof RoundServiceError) {
        const status = error.code === "ROUND_ALREADY_OPEN" ? 409 : 422;
        return { status, jsonBody: { error: error.code } };
      }
      throw error;
    }
  };
}

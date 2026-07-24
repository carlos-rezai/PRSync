import type { HttpRequest } from "@azure/functions";

// The seam that turns an inbound request's ADO bearer token into a
// verified caller identity. The done-toggle target is *always* the
// authenticated caller — never a body field — so this is the only
// source of "who is acting". A null result means the token is
// missing/invalid and the request is unauthenticated (401). Feature 2
// supplies the real ADO token-validation adapter behind this interface.

export interface ResolvedIdentity {
  adoId: string;
}

export interface IdentityResolver {
  resolve(request: HttpRequest): Promise<ResolvedIdentity | null>;
}

import type { HttpRequest } from "@azure/functions";
import type {
  IdentityResolver,
  ResolvedIdentity,
} from "../IdentityResolver/IdentityResolver";

// The real IdentityResolver: the seam every handler authorizes through.
//
// PRSync does not validate the token itself. The panel's token is issued
// by Azure DevOps to the extension, so ADO is its authority — this
// resolver presents the token back to ADO's own profile endpoint and takes
// the identity ADO answers with. That makes "is this token real?" and
// "whose is it?" the same question, asked of the only system entitled to
// answer it, instead of a signature check PRSync would have to keep
// correct as ADO's issuance changes.
//
// The consequence is that this module's error handling IS its security
// behaviour. Three distinct answers, and conflating any two is a real
// defect:
//
//   - `null` — the caller is not authenticated (401). Reserved for ADO
//     actually rejecting the token, and for a request that never carried
//     a bearer token to reject.
//   - throw — PRSync cannot tell who the caller is (500). Reserved for
//     ADO being broken or answering something unreadable.
//   - an `adoId` — only ever one ADO itself returned.
//
// `mapApiError` in the panel turns 401 into "your session expired, refresh
// the page". An ADO outage answered with `null` would therefore send every
// viewer into a reload loop against a service that is not going to start
// recognising them until it recovers.

/**
 * Azure DevOps's own "who is this token" endpoint.
 *
 * A constant rather than a setting, on purpose: an env-settable identity
 * oracle turns one wrong deployment value into "every caller is whoever
 * that host says they are" — and the whole reason to delegate is that ADO,
 * specifically, is the authority.
 */
export const ADO_PROFILE_URL =
  "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1";

/** The two things the resolver is allowed to read off ADO's answer. */
export interface ProfileResponse {
  status: number;
  json(): Promise<unknown>;
}

/** The one outbound call this module makes, as an injectable seam. */
export type ProfileFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<ProfileResponse>;

export interface AdoIdentityResolverDeps {
  /** Defaults to the runtime's `fetch`; injected in tests. */
  fetch?: ProfileFetch;
}

export function createAdoIdentityResolver(
  deps: AdoIdentityResolverDeps = {}
): IdentityResolver {
  const fetchProfile = deps.fetch ?? defaultProfileFetch;

  return {
    async resolve(request: HttpRequest): Promise<ResolvedIdentity | null> {
      // Unauthenticated is decidable here, and spending a round trip to
      // have ADO tell us what an absent header already says would put the
      // health of the login path on the throughput of an outbound call.
      const token = bearerToken(request);
      if (token === null) return null;

      const response = await fetchProfile(ADO_PROFILE_URL, {
        // The caller's own token, unaltered. The resolver has no credential
        // of its own and must not acquire one: it is asking "who does THIS
        // token belong to", so swapping in a service identity would answer
        // a different question and authorize every caller as one person.
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          // Without this, ADO answers a rejected token with a 302 to its
          // sign-in page rather than a 401. Followed, that lands as a 200
          // of HTML and surfaces here as "unreadable profile" — a 500,
          // when the honest answer is 401 and the panel's whole
          // session-expiry recovery hangs off telling the two apart.
          "X-TFS-FedAuthRedirect": "Suppress",
        },
      });

      // ADO refusing the token is the one thing that legitimately means
      // "not authenticated".
      if (response.status === 401 || response.status === 403) return null;

      if (response.status < 200 || response.status >= 300) {
        // Anything else says nothing about the token — a 5xx is ADO being
        // broken, not the caller being unknown.
        throw new Error(
          `Azure DevOps answered ${response.status} for the caller's profile.`
        );
      }

      return { adoId: readProfileId(await readJson(response)) };
    },
  };
}

/**
 * The bearer token, or `null` when the header is absent or is not one.
 * `Basic ...`, a bare token and an empty `Bearer` are all rejected here
 * rather than sent to ADO to be rejected there.
 */
function bearerToken(request: HttpRequest): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+$/i.test(header)
    ? (header.split(/\s+/)[1] as string)
    : null;
}

async function readJson(response: ProfileResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A 200 PRSync cannot read is a broken assumption about ADO's
    // contract, not a rejected caller.
    throw new Error("Azure DevOps returned an unreadable profile body.");
  }
}

/**
 * The `id` ADO named, or a throw. The one outcome that must be impossible
 * is a resolved identity ADO did not name — every authorization decision
 * downstream is made against this value.
 */
function readProfileId(body: unknown): string {
  const id =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { id?: unknown }).id
      : undefined;

  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Azure DevOps returned a profile with no usable id.");
  }
  return id.trim();
}

/** The runtime's `fetch`, narrowed to the two members the resolver reads. */
async function defaultProfileFetch(
  url: string,
  init: { headers: Record<string, string> }
): Promise<ProfileResponse> {
  // `manual`, so a redirect can never be followed into a 200 carrying a
  // sign-in page. The suppression header above should mean there is none;
  // this is what keeps an unexpected one an error rather than a body the
  // resolver tries to read an identity out of.
  const response = await fetch(url, {
    headers: init.headers,
    redirect: "manual",
  });
  return {
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
}

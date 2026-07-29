import { describe, it, expect, vi } from "vitest";
import {
  ADO_PROFILE_URL,
  createAdoIdentityResolver,
  type ProfileFetch,
  type ProfileResponse,
} from "./AdoIdentityResolver";
import { makeRequest } from "../../test/fixtures/fakes";

// The real IdentityResolver: the seam every handler authorizes through,
// and until now the one collaborator `packages/api` had no implementation
// of at all.
//
// PRSync does not validate the token itself. The panel's token is issued
// by Azure DevOps to the extension, so ADO is its authority — the resolver
// presents the token back to ADO's own profile endpoint and takes the
// identity ADO answers with. That makes "is this token real?" and "whose
// is it?" the same question, asked of the only system entitled to answer
// it, instead of a signature check PRSync would have to keep correct as
// ADO's issuance changes.
//
// The consequence is that this module's error handling IS its security
// behaviour, which is why the failure cases below outnumber the happy
// one. Three distinct answers, and conflating any two is a real defect:
//
//   - `null` — the caller is not authenticated (401). Reserved for ADO
//     actually rejecting the token, and for a request that never carried
//     a bearer token to reject.
//   - throw — PRSync cannot tell who the caller is (500). Reserved for
//     ADO being broken or answering something unreadable.
//   - an `adoId` — only ever one ADO itself returned.
//
// `mapApiError` in the panel turns 401 into "your session expired,
// refresh the page". An ADO outage answered with `null` would therefore
// send every viewer into a reload loop against a service that is not
// going to start recognising them.

/** An `id` shaped like the GUID ADO returns for a profile. */
const ADO_ID = "6f5e4d3c-2b1a-0908-1716-2524232221f0";

const TOKEN = "an-ado-issued-access-token";

/** A request carrying the panel's bearer token, as the runtime delivers it. */
function makeAuthorizedRequest(authorization = `Bearer ${TOKEN}`) {
  return makeRequest({ headers: { authorization } });
}

/**
 * The one outbound call this module makes, faked at the boundary. Only
 * `status` and `json()` are honoured, because those are the only two
 * things the resolver is allowed to read — anything more would be the
 * fake teaching a coupling the module does not have.
 */
function makeProfileFetch(
  response: { status: number; body?: unknown } = { status: 200 }
): ProfileFetch {
  return vi.fn(
    (): Promise<ProfileResponse> =>
      Promise.resolve({
        status: response.status,
        json: () =>
          response.body === undefined
            ? Promise.reject(new Error("no json body"))
            : Promise.resolve(response.body),
      })
  );
}

describe("createAdoIdentityResolver", () => {
  it("resolves the caller to the adoId ADO returns for the token", async () => {
    const fetch = makeProfileFetch({ status: 200, body: { id: ADO_ID } });
    const resolver = createAdoIdentityResolver({ fetch });

    expect(await resolver.resolve(makeAuthorizedRequest())).toEqual({
      adoId: ADO_ID,
    });
  });

  it("presents the caller's own token to ADO, unaltered", async () => {
    // The resolver has no credential of its own and must not acquire one:
    // it is asking "who does THIS token belong to", so swapping in a
    // service identity would answer a different question entirely and
    // authorize every caller as the same person.
    const fetch = makeProfileFetch({ status: 200, body: { id: ADO_ID } });

    await createAdoIdentityResolver({ fetch }).resolve(
      makeAuthorizedRequest()
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }) as Record<string, string>,
      })
    );
  });

  it("asks Azure DevOps itself, over https, by default", async () => {
    // The URL is a constant rather than a setting on purpose. An
    // env-settable identity oracle turns one wrong deployment value into
    // "every caller is whoever that host says they are" — and the whole
    // reason to delegate is that ADO, specifically, is the authority.
    const fetch = makeProfileFetch({ status: 200, body: { id: ADO_ID } });

    await createAdoIdentityResolver({ fetch }).resolve(
      makeAuthorizedRequest()
    );

    expect(ADO_PROFILE_URL).toMatch(/^https:\/\//);
    expect(fetch).toHaveBeenCalledWith(ADO_PROFILE_URL, expect.anything());
  });

  it("rejects a request with no Authorization header without asking ADO", async () => {
    // Unauthenticated is decidable here, and spending a round trip to
    // have ADO tell us what an absent header already says would put the
    // health of the login path on the throughput of an outbound call.
    const fetch = makeProfileFetch();
    const request = makeRequest({ headers: {} });

    expect(await createAdoIdentityResolver({ fetch }).resolve(request)).toBe(
      null
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an Authorization header that is not a bearer token, without asking ADO", async () => {
    const fetch = makeProfileFetch();

    for (const header of [
      "Basic dXNlcjpwYXNz",
      "Bearer",
      "Bearer ",
      TOKEN,
      "",
    ]) {
      expect(
        await createAdoIdentityResolver({ fetch }).resolve(
          makeAuthorizedRequest(header)
        ),
        `"${header}" was accepted as a bearer token`
      ).toBe(null);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves to null when ADO rejects the token", async () => {
    // ADO refusing the token is the one thing that legitimately means
    // "not authenticated" — 401 from us, and the panel tells the viewer
    // to refresh and sign back in.
    for (const status of [401, 403]) {
      const fetch = makeProfileFetch({ status });

      expect(
        await createAdoIdentityResolver({ fetch }).resolve(
          makeAuthorizedRequest()
        ),
        `ADO ${status} did not resolve to null`
      ).toBe(null);
    }
  });

  it("throws when ADO is unavailable rather than reporting the caller unauthenticated", async () => {
    // A 5xx says nothing about the token. Answering `null` would surface
    // as 401 "your session expired — refresh to sign back in", sending
    // every viewer into a reload loop against a service that is not going
    // to start recognising them until it recovers. A 500 is the honest
    // answer and the one the panel shows as a plain failure.
    for (const status of [500, 502, 503]) {
      const fetch = makeProfileFetch({ status });

      await expect(
        createAdoIdentityResolver({ fetch }).resolve(makeAuthorizedRequest()),
        `ADO ${status} was reported as unauthenticated`
      ).rejects.toThrow();
    }
  });

  it("throws rather than invent an adoId when the profile carries no usable id", async () => {
    // A 200 PRSync cannot read is a broken assumption about ADO's
    // contract, not a rejected caller. The one outcome that must be
    // impossible is a resolved identity that ADO did not name — every
    // authorization decision downstream is made against this value.
    for (const body of [
      {},
      { id: null },
      { id: 42 },
      { id: "" },
      { id: "   " },
      [],
      null,
      "not-an-object",
    ]) {
      const fetch = makeProfileFetch({ status: 200, body });

      await expect(
        createAdoIdentityResolver({ fetch }).resolve(makeAuthorizedRequest()),
        `${JSON.stringify(body)} produced an identity`
      ).rejects.toThrow();
    }
  });
});

import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./normalizeEmail";
import { PERSON, PERSON_EMAIL_VARIANTS } from "../../test/fixtures/fixtures";

// One person's address reaches PRSync from several directions — ADO's
// `uniqueName`, Teams' `userPrincipalName`, and eventually a hand-typed
// override — and they disagree about case and padding. The normalized
// form is the row key of the TeamsIdentities table, so two spellings that
// do not normalize alike are two rows: the person installs the app and
// then never gets a DM, with nothing anywhere reporting a fault.

describe("normalizeEmail", () => {
  it("resolves addresses differing only by case or surrounding whitespace to one key", () => {
    for (const variant of PERSON_EMAIL_VARIANTS) {
      expect(
        normalizeEmail(variant),
        `${JSON.stringify(variant)} must key the same identity as ${PERSON.email}`
      ).toBe(PERSON.email);
    }
  });

  it("leaves an address that is already normalized untouched", () => {
    // Normalization has to be idempotent: it runs on the way in at
    // capture and again on the way in at resolve, and a second pass that
    // changed anything would be a lookup miss.
    expect(normalizeEmail(PERSON.email)).toBe(PERSON.email);
    expect(normalizeEmail(normalizeEmail(PERSON_EMAIL_VARIANTS[0]))).toBe(
      PERSON.email
    );
  });
});

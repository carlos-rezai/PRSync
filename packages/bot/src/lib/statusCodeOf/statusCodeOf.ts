// Read structurally, with no import of `@azure/data-tables`: the SDK
// surfaces HTTP faults as `RestError`-shaped objects carrying a numeric
// `statusCode`, and reading it by shape is what keeps this a pure `lib/`
// helper while leaving `storage/` the only layer coupled to the SDK.
//
// Both repositories need it for the same reason, and it is the same
// reason: a 404 is a FACT, not a fault. "No identity" has to be
// distinguishable from "storage broke", and an uninstall for a
// conversation PRSync never captured has to be distinguishable from a
// delete that genuinely failed. Getting that wrong poisons a queue
// message over an outcome that was already what was wanted.

/**
 * The HTTP status an SDK error carries, or `undefined` if it carries none
 * that can be read as one.
 *
 * Deliberately total: it is called from a `catch`, where the value has no
 * guaranteed type at all. A `throw "gone"` or a rejected promise carrying
 * `null` must return `undefined` rather than throw a second error out of
 * the handler that was meant to contain the first.
 */
export function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code: unknown = error.statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

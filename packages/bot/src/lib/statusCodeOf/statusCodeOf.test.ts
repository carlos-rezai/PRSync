import { describe, it, expect } from "vitest";
import { statusCodeOf } from "./statusCodeOf";

// Every function in `lib/` has a test — see .claude/CLAUDE.md. This one is
// worth more than its size suggests: both repositories decide whether a
// 404 is a fact or a fault by what it answers, so a helper that reported
// `undefined` for a real 404 would turn "this person never installed the
// bot" into a thrown error, and an uninstall redelivery into a poisoned
// queue message.
//
// It is called from a `catch`, so the non-object cases are not
// hypothetical: nothing in JavaScript guarantees that what was thrown is
// an object at all.

describe("statusCodeOf", () => {
  it("reads a numeric status off an SDK error", () => {
    expect(statusCodeOf({ statusCode: 404 })).toBe(404);
    expect(statusCodeOf({ statusCode: 412 })).toBe(412);
  });

  it("reads it off a real Error carrying the field", () => {
    // What the SDK actually throws is an `Error` subclass with the status
    // hung off it, not a plain object.
    const error = Object.assign(
      new Error("The specified entity was not found."),
      {
        statusCode: 404,
      }
    );

    expect(statusCodeOf(error)).toBe(404);
  });

  it("ignores a status that is not a number", () => {
    // A string "404" must not be read as one: the callers compare with
    // `=== 404`, and a helper that returned the string would make every
    // comparison quietly false — the 404 would be rethrown as a fault.
    expect(statusCodeOf({ statusCode: "404" })).toBeUndefined();
    expect(statusCodeOf({ statusCode: null })).toBeUndefined();
    expect(statusCodeOf({ statusCode: undefined })).toBeUndefined();
  });

  it("returns undefined for an error carrying no status", () => {
    expect(statusCodeOf(new Error("connect ECONNREFUSED"))).toBeUndefined();
    expect(statusCodeOf({})).toBeUndefined();
  });

  it("returns undefined for what was never an object", () => {
    // `throw "gone"` is legal, and this is called from a `catch`. Throwing
    // a second error out of the handler meant to contain the first would
    // lose the original fault entirely.
    for (const thrown of [null, undefined, "404", 404, false] as const) {
      expect(statusCodeOf(thrown), String(thrown)).toBeUndefined();
    }
  });
});

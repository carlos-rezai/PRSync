import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

// The failed-load state. Unlike a failed MUTATION — which routes through
// `mapApiError` and gets a recovery specific to what went wrong — a failed
// LOAD has no round to reconcile against and no control to sit next to, so
// it says the one thing that is always true and always actionable: refresh
// the page.

describe("ErrorState", () => {
  it("says the round could not be loaded and what to do about it", () => {
    render(<ErrorState />);

    expect(
      screen.getByText(/couldn't load the current round/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/refresh the page/i)).toBeInTheDocument();
  });
});

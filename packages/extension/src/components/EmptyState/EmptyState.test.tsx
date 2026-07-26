import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

// The shared `ZeroData` empty state, used for both of the panel's empties:
// a round with no tracked reviewers, and a bystander on a PR where no
// round has been opened yet (panel-layout-spec.md, "Empty").

describe("EmptyState", () => {
  it("renders the primary text", () => {
    render(<EmptyState primaryText="No round yet" />);

    expect(screen.getByText("No round yet")).toBeInTheDocument();
  });

  it("renders the secondary text when given one", () => {
    render(
      <EmptyState
        primaryText="No round yet"
        secondaryText="The author hasn't opened a review round on this PR."
      />
    );

    expect(
      screen.getByText("The author hasn't opened a review round on this PR.")
    ).toBeInTheDocument();
  });

  it("renders nothing in the secondary slot when not given one", () => {
    const { container } = render(<EmptyState primaryText="No reviewers" />);

    // The caller decides whether an empty deserves an explanation; the
    // component must not invent one.
    expect(container.textContent).toBe("No reviewers");
  });
});

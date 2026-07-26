import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingState } from "./LoadingState";

// The initial-load state: a native `Spinner` while the first
// getCurrentRound is in flight (panel-layout-spec.md, "Loading").

describe("LoadingState", () => {
  it("tells the viewer the panel is loading", () => {
    render(<LoadingState />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

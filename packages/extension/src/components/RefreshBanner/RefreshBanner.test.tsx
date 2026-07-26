import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefreshBanner } from "./RefreshBanner";

// The conditional refresh banner (panel-layout-spec.md, row 8), shown once
// polling has found that someone ELSE changed the round the viewer is
// reading.
//
// The panel never silently live-patches state under a cursor, so this
// banner is the WHOLE update path for a drifted panel — which makes its
// action the one thing that must always be there and always be clickable.
// Its severity is informational rather than error on purpose: someone
// else finishing their review is normal, not a fault, and dressing it as
// one would train viewers to ignore real errors.

describe("RefreshBanner", () => {
  it("says the round changed since the viewer loaded it", () => {
    render(<RefreshBanner onRefresh={vi.fn()} />);

    expect(
      screen.getByText(/changed since you loaded it/i)
    ).toBeInTheDocument();
  });

  it("offers a refresh action", () => {
    render(<RefreshBanner onRefresh={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /refresh/i })
    ).toBeInTheDocument();
  });

  it("calls up exactly once when the action is clicked", () => {
    const onRefresh = vi.fn();
    render(<RefreshBanner onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("is informational, not an error", () => {
    // Someone else finishing their review is normal. Rendering it as an
    // error would teach viewers to ignore the banner that matters. The
    // severity reaches the DOM as `azure-devops-ui`'s own modifier class,
    // which is the only place it is observable.
    const { container } = render(<RefreshBanner onRefresh={vi.fn()} />);

    expect(container.querySelector(".severity-info")).not.toBeNull();
    expect(container.querySelector(".severity-error")).toBeNull();
  });
});

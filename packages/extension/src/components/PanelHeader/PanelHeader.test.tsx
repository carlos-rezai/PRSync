import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PanelHeader } from "./PanelHeader";

// The static panel title. Its whole job is to be a native
// `azure-devops-ui` Header carrying the product name, so the panel reads
// as part of the host PR page rather than as an embedded stranger
// (panel-layout-spec.md, row 1).

describe("PanelHeader", () => {
  it("names the product in a heading", () => {
    render(<PanelHeader />);

    expect(screen.getByRole("heading", { name: "PRSync" })).toBeInTheDocument();
  });
});

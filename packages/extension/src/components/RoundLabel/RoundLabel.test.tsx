import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { RoundLabel } from "./RoundLabel";

// The round label (panel-layout-spec.md, row 2): an inline field for the
// author while the round is `open`, plain display text for everyone else
// and for every terminal round.
//
// The commit rule is the part worth pinning down. Blur and Enter both
// commit, and both hand up the EXACT text the author typed — never a
// re-derivation into the canonical wording, because the author's own
// wording is the whole reason the field is editable. An unchanged value
// commits nothing, so leaving the field alone is not a write.
//
// One mechanical note: `azure-devops-ui`'s TextField routes blur through
// `FocusWithin`, which defers the callback behind a timer so that moving
// focus WITHIN the control does not read as leaving it. Every blur
// assertion here therefore has to wait for that timer rather than assert
// synchronously — including the negative ones, which is what `settle`
// is for.

const LABEL = "Round 2 — Implementation Review";

function renderLabel(props: { editable?: boolean } = {}) {
  const onCommit = vi.fn();
  render(
    <RoundLabel
      label={LABEL}
      editable={props.editable ?? true}
      onCommit={onCommit}
    />
  );
  return { onCommit };
}

/** Lets the deferred blur callback run, so "never committed" is provable. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("RoundLabel", () => {
  it("renders plain text when not editable", () => {
    renderLabel({ editable: false });

    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders a field holding the stored label when editable", () => {
    renderLabel();

    expect(screen.getByRole("textbox")).toHaveValue(LABEL);
  });

  it("commits the exact typed text on blur", async () => {
    const { onCommit } = renderLabel();
    const field = screen.getByRole("textbox");

    fireEvent.change(field, { target: { value: "Round 2 — Please re-read" } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("Round 2 — Please re-read")
    );
  });

  it("commits the exact typed text on Enter", () => {
    // Enter commits synchronously — it is a keystroke, not a focus change.
    const { onCommit } = renderLabel();
    const field = screen.getByRole("textbox");

    fireEvent.change(field, { target: { value: "Round 2 — Second pass" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith("Round 2 — Second pass");
  });

  it("commits nothing when the author never typed", async () => {
    // Focusing and leaving a field is not an edit.
    const { onCommit } = renderLabel();
    const field = screen.getByRole("textbox");

    fireEvent.blur(field);
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits nothing when the author typed the value back to what it was", async () => {
    const { onCommit } = renderLabel();
    const field = screen.getByRole("textbox");

    fireEvent.change(field, { target: { value: "Round 2 — Something else" } });
    fireEvent.change(field, { target: { value: LABEL } });
    fireEvent.blur(field);
    await settle();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("ignores keys other than Enter", () => {
    const { onCommit } = renderLabel();
    const field = screen.getByRole("textbox");

    fireEvent.change(field, { target: { value: "Round 2 — Half typed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.keyDown(field, { key: "a" });

    expect(onCommit).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposeForm } from "./ComposeForm";

// What the author sees when no round is open — a `204`, or a terminal
// round they can follow with the next one (panel-layout-spec.md rows 2, 3,
// 6). It replaces the read-only view for the author rather than sitting
// beside it.
//
// The form owns exactly two presentation values, and the label is the
// subtle one. While UNTOUCHED it is not a string at all: the field shows
// the derived default and FOLLOWS the phase toggle, and submitting sends
// `undefined` so the API generates the canonical wording. The moment the
// author types, their text is theirs — it stops following the toggle and
// submits verbatim. That is what keeps the panel and the DB from ever
// diverging on wording while still letting the author name a round.
//
// Everything past that — reading ADO afresh, calling `openRound`, error
// recovery — belongs to the `App`.

function renderForm(
  props: Partial<React.ComponentProps<typeof ComposeForm>> = {}
) {
  const onOpenRound = vi.fn();
  render(
    <ComposeForm
      nextRoundNumber={3}
      defaultPhase="spec"
      canOpen={true}
      submitting={false}
      openError={null}
      onOpenRound={onOpenRound}
      {...props}
    />
  );
  return { onOpenRound };
}

const ready = (): HTMLElement =>
  screen.getByRole("button", { name: /ready for review/i });
const labelField = (): HTMLElement => screen.getByRole("textbox");

describe("ComposeForm", () => {
  it("pre-fills the label with the derived default for the next round", () => {
    renderForm({ nextRoundNumber: 3, defaultPhase: "spec" });

    expect(labelField()).toHaveValue("Round 3 — Spec Review");
  });

  it("follows the phase toggle while the label is untouched", () => {
    renderForm({ nextRoundNumber: 3, defaultPhase: "spec" });

    fireEvent.click(
      screen.getByRole("button", { name: /implementation review/i })
    );

    expect(labelField()).toHaveValue("Round 3 — Implementation Review");
  });

  it("stops following the phase toggle once the author has typed", () => {
    // The author's wording is theirs; a later toggle must not overwrite it.
    renderForm();

    fireEvent.change(labelField(), { target: { value: "Round 3 — Mine" } });
    fireEvent.click(
      screen.getByRole("button", { name: /implementation review/i })
    );

    expect(labelField()).toHaveValue("Round 3 — Mine");
  });

  it("submits an untouched label as undefined", () => {
    // Omitted, not sent as the derived string — the API owns the canonical
    // wording, so the panel must not send a client-derived copy of it.
    const { onOpenRound } = renderForm({ defaultPhase: "spec" });

    fireEvent.click(ready());

    expect(onOpenRound).toHaveBeenCalledWith("spec", undefined);
  });

  it("submits an edited label as the author's exact text", () => {
    const { onOpenRound } = renderForm({ defaultPhase: "spec" });

    fireEvent.change(labelField(), {
      target: { value: "Round 3 — Please look again" },
    });
    fireEvent.click(ready());

    expect(onOpenRound).toHaveBeenCalledWith(
      "spec",
      "Round 3 — Please look again"
    );
  });

  it("starts on the previous round's phase and submits it", () => {
    const { onOpenRound } = renderForm({ defaultPhase: "implementation" });

    fireEvent.click(ready());

    expect(onOpenRound).toHaveBeenCalledWith("implementation", undefined);
  });

  it("submits the phase the author switched to", () => {
    const { onOpenRound } = renderForm({ defaultPhase: "spec" });

    fireEvent.click(
      screen.getByRole("button", { name: /implementation review/i })
    );
    fireEvent.click(ready());

    expect(onOpenRound).toHaveBeenCalledWith("implementation", undefined);
  });

  it("disables Ready with a hint when there are no eligible reviewers", () => {
    const { onOpenRound } = renderForm({ canOpen: false });

    expect(ready()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/eligible reviewer/i)).toBeInTheDocument();

    fireEvent.click(ready());
    expect(onOpenRound).not.toHaveBeenCalled();
  });

  it("shows no hint when a round can be opened", () => {
    renderForm({ canOpen: true });

    expect(screen.queryByText(/eligible reviewer/i)).not.toBeInTheDocument();
  });

  it("disables Ready while a round-open is in flight", () => {
    // The author cannot fire a second open on top of the first.
    const { onOpenRound } = renderForm({ submitting: true });

    expect(ready()).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(ready());
    expect(onOpenRound).not.toHaveBeenCalled();
  });

  it("renders the open error when there is one", () => {
    renderForm({
      openError: "This round needs an eligible reviewer in ADO.",
    });

    expect(
      screen.getByText("This round needs an eligible reviewer in ADO.")
    ).toBeInTheDocument();
  });

  it("renders no error slot when there is none", () => {
    renderForm({ openError: null });

    expect(
      screen.queryByText(/needs an eligible reviewer in ADO\./)
    ).toBeNull();
  });
});

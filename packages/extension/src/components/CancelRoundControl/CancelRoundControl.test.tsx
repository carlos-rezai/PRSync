import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { CancelRoundControl } from "./CancelRoundControl";

// The author's Cancel round control (panel-layout-spec.md, row 7).
//
// Cancelling is a SILENT abandonment — the round goes terminal and, unlike
// a real close, no Teams DM goes out — so it must never be one misclick
// away. The component's entire reason to exist is that gap: the button
// only OPENS a confirmation, and nothing reaches the `App` until the
// author confirms. The dialog's open/closed state is presentation and
// lives here; the mutation and its error recovery belong to the `App`.

function renderControl() {
  const onCancelRound = vi.fn();
  render(<CancelRoundControl onCancelRound={onCancelRound} />);
  return { onCancelRound };
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: /cancel round/i });
}

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(trigger());
  return screen.findByRole("dialog");
}

describe("CancelRoundControl", () => {
  it("shows only the trigger until it is clicked", () => {
    renderControl();

    expect(trigger()).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the confirmation without cancelling anything", async () => {
    const { onCancelRound } = renderControl();

    const dialog = await openDialog();

    expect(dialog).toBeInTheDocument();
    expect(onCancelRound).not.toHaveBeenCalled();
  });

  it("explains what cancelling costs before the author commits to it", async () => {
    renderControl();

    const dialog = await openDialog();

    // The two consequences that make this irreversible-feeling: nobody is
    // told, and the round is gone. Both belong in front of the author.
    expect(within(dialog).getByText(/not notified/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/abandoned/i)).toBeInTheDocument();
  });

  it("dismisses without cancelling when the author keeps the round", async () => {
    const { onCancelRound } = renderControl();
    const dialog = await openDialog();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /keep round/i })
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(onCancelRound).not.toHaveBeenCalled();
  });

  it("calls up exactly once and closes the dialog on confirm", async () => {
    const { onCancelRound } = renderControl();
    const dialog = await openDialog();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /cancel round/i })
    );

    expect(onCancelRound).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("can be re-opened after a dismissal", async () => {
    // Dismissing must reset the confirmation, not consume the control.
    const { onCancelRound } = renderControl();
    const first = await openDialog();
    fireEvent.click(within(first).getByRole("button", { name: /keep round/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    const second = await openDialog();

    expect(second).toBeInTheDocument();
    expect(onCancelRound).not.toHaveBeenCalled();
  });
});

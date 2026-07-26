import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoundView } from "./RoundView";
import {
  AUTHOR_ID,
  REVIEWER_ONE_ID,
  STRANGER_ID,
  makeCancelledRound,
  makeClosedRound,
  makeRound,
} from "../../test/fixtures/fixtures";

// The view of a present round. What it owns is COMPOSITION — which of its
// children are live for whom — rather than any behaviour of its own; the
// children's own rules are asserted in their own files.
//
// Two gates decide everything. `canManage` (author AND open) turns on the
// editable label and the Cancel round control. `canToggleOwn` (a tracked
// reviewer AND open) turns on the own-row checkbox. Both collapse on a
// terminal round, which is what "a closed round is frozen for everyone"
// means in practice — including for the author, who otherwise has the most
// privilege here.
//
// The re-key on the stored label is the non-obvious one, and it is a real
// bug guard: without it, a round returned by the API would render behind a
// draft the author had left in the field.

function renderView(
  props: Partial<React.ComponentProps<typeof RoundView>> = {}
) {
  const handlers = {
    onToggleOwn: vi.fn(),
    onEditLabel: vi.fn(),
    onCancelRound: vi.fn(),
  };
  const view = render(
    <RoundView
      round={makeRound()}
      viewerAdoId={REVIEWER_ONE_ID}
      mutationError={null}
      {...handlers}
      {...props}
    />
  );
  return { ...handlers, view };
}

const cancelButton = () =>
  screen.queryByRole("button", { name: /cancel round/i });
const labelField = () => screen.queryByRole("textbox");
const ownRow = () => screen.getByRole("checkbox", { name: /Rev One/i });

describe("RoundView", () => {
  it("renders the round's label, phase and status", () => {
    renderView({ round: makeRound(), viewerAdoId: STRANGER_ID });

    expect(
      screen.getByText("Round 2 — Implementation Review")
    ).toBeInTheDocument();
    expect(screen.getByText("Implementation Review")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 reviewed")).toBeInTheDocument();
  });

  it("gives the author an editable label and the cancel control on an open round", () => {
    renderView({ round: makeRound(), viewerAdoId: AUTHOR_ID });

    expect(labelField()).toHaveValue("Round 2 — Implementation Review");
    expect(cancelButton()).toBeInTheDocument();
  });

  it.each([
    ["a reviewer", REVIEWER_ONE_ID],
    ["a bystander", STRANGER_ID],
  ])(
    "gives %s neither the label field nor the cancel control",
    (_who, viewer) => {
      renderView({ round: makeRound(), viewerAdoId: viewer });

      expect(labelField()).toBeNull();
      expect(cancelButton()).toBeNull();
      expect(
        screen.getByText("Round 2 — Implementation Review")
      ).toBeInTheDocument();
    }
  );

  it("makes a reviewer's own row live on an open round", () => {
    const { onToggleOwn } = renderView({ viewerAdoId: REVIEWER_ONE_ID });

    fireEvent.click(ownRow());

    expect(onToggleOwn).toHaveBeenCalledTimes(1);
  });

  it("gives the author no live row of their own", () => {
    // The author is never a reviewer on their own round.
    const { onToggleOwn } = renderView({ viewerAdoId: AUTHOR_ID });

    fireEvent.click(ownRow());

    expect(onToggleOwn).not.toHaveBeenCalled();
  });

  it.each([
    ["closed", makeClosedRound()],
    ["cancelled", makeCancelledRound()],
  ])("freezes a %s round for the author", (_status, round) => {
    // Every terminal round is frozen for EVERYONE — including the viewer
    // with the most privilege on it.
    const { onCancelRound } = renderView({ round, viewerAdoId: AUTHOR_ID });

    expect(labelField()).toBeNull();
    expect(cancelButton()).toBeNull();
    expect(onCancelRound).not.toHaveBeenCalled();
  });

  it("freezes a terminal round for a reviewer", () => {
    const { onToggleOwn } = renderView({
      round: makeCancelledRound(),
      viewerAdoId: REVIEWER_ONE_ID,
    });

    fireEvent.click(ownRow());

    expect(onToggleOwn).not.toHaveBeenCalled();
  });

  it("commits a label edit up to the caller", () => {
    const { onEditLabel } = renderView({ viewerAdoId: AUTHOR_ID });
    const field = screen.getByRole("textbox");

    fireEvent.change(field, { target: { value: "Round 2 — Renamed" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onEditLabel).toHaveBeenCalledWith("Round 2 — Renamed");
  });

  it("renders the inline mutation error when there is one", () => {
    renderView({ mutationError: "Something went wrong. Please try again." });

    expect(
      screen.getByText("Something went wrong. Please try again.")
    ).toBeInTheDocument();
  });

  it("renders no error slot when there is none", () => {
    renderView({ mutationError: null });

    expect(screen.queryByText(/went wrong/i)).toBeNull();
  });

  it("replaces a stale draft when the stored label changes", () => {
    // The label field is re-keyed on the stored label. Without that, the
    // round the API returns would render behind whatever the author had
    // left in the field — the panel would show a rename that never
    // happened.
    const { view } = renderView({
      round: makeRound(),
      viewerAdoId: AUTHOR_ID,
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Round 2 — A draft never committed" },
    });
    expect(screen.getByRole("textbox")).toHaveValue(
      "Round 2 — A draft never committed"
    );

    view.rerender(
      <RoundView
        round={makeRound({ label: "Round 2 — Stored by the API" })}
        viewerAdoId={AUTHOR_ID}
        onToggleOwn={vi.fn()}
        onEditLabel={vi.fn()}
        onCancelRound={vi.fn()}
        mutationError={null}
      />
    );

    expect(screen.getByRole("textbox")).toHaveValue(
      "Round 2 — Stored by the API"
    );
  });
});

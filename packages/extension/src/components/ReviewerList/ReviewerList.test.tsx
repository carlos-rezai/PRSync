import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewerList } from "./ReviewerList";
import {
  AUTHOR_ID,
  REVIEWER_ONE_ID,
  REVIEWER_TWO_ID,
  STRANGER_ID,
  makeReviewer,
} from "../../test/fixtures/fixtures";

// The reviewer status list (panel-layout-spec.md, row 4): one row per
// reviewer in the round's frozen open-time snapshot.
//
// The rule the component owns is who may interact. `Done` is owned
// exclusively by the reviewer it belongs to, so only the viewer's OWN row
// is ever live, and only when the caller says the round still allows it
// (`canToggleOwn`). Everyone else's row, and every row for an author or a
// bystander, is read-only. That is a presentation guard rather than a
// security one — the API re-authorizes by adoId — but it is the guard that
// stops the panel from offering an action it knows will be refused.

const reviewers = [
  makeReviewer({ adoId: REVIEWER_ONE_ID, displayName: "Rev One" }),
  makeReviewer({ adoId: REVIEWER_TWO_ID, displayName: "Rev Two", done: true }),
];

function renderList(
  props: Partial<React.ComponentProps<typeof ReviewerList>> = {}
) {
  const onToggleOwn = vi.fn();
  render(
    <ReviewerList
      reviewers={reviewers}
      viewerAdoId={REVIEWER_ONE_ID}
      canToggleOwn={true}
      onToggleOwn={onToggleOwn}
      {...props}
    />
  );
  return { onToggleOwn };
}

function row(name: RegExp): HTMLElement {
  return screen.getByRole("checkbox", { name });
}

describe("ReviewerList", () => {
  it("renders one row per snapshotted reviewer", () => {
    renderList();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Rev One")).toBeInTheDocument();
    expect(screen.getByText("Rev Two")).toBeInTheDocument();
  });

  it("shows each reviewer's Done state", () => {
    renderList();

    expect(row(/Rev One/i)).toHaveAttribute("aria-checked", "false");
    expect(row(/Rev Two/i)).toHaveAttribute("aria-checked", "true");
  });

  it("renders nothing but an empty list when the snapshot is empty", () => {
    renderList({ reviewers: [] });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("makes only the viewer's own row interactive", () => {
    renderList({ viewerAdoId: REVIEWER_ONE_ID });

    expect(row(/Rev One/i)).toHaveAttribute("aria-disabled", "false");
    expect(row(/Rev Two/i)).toHaveAttribute("aria-disabled", "true");
  });

  it("calls up exactly once when the viewer clicks their own row", () => {
    const { onToggleOwn } = renderList({ viewerAdoId: REVIEWER_ONE_ID });

    fireEvent.click(row(/Rev One/i));

    expect(onToggleOwn).toHaveBeenCalledTimes(1);
  });

  it("never calls up for someone else's row", () => {
    // Clicking another reviewer's row can not signal Done on their behalf.
    const { onToggleOwn } = renderList({ viewerAdoId: REVIEWER_ONE_ID });

    fireEvent.click(row(/Rev Two/i));

    expect(onToggleOwn).not.toHaveBeenCalled();
  });

  it("freezes every row when the caller says the round no longer allows it", () => {
    // `canToggleOwn` is how a terminal round reaches this component: the
    // viewer is still a reviewer, but their Done is frozen.
    const { onToggleOwn } = renderList({ canToggleOwn: false });

    expect(row(/Rev One/i)).toHaveAttribute("aria-disabled", "true");
    expect(row(/Rev Two/i)).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(row(/Rev One/i));
    expect(onToggleOwn).not.toHaveBeenCalled();
  });

  it.each([
    ["the author", AUTHOR_ID],
    ["a bystander", STRANGER_ID],
  ])("shows %s every row read-only", (_who, viewerAdoId) => {
    // Neither owns a row here, so there is no own-row to make live.
    const { onToggleOwn } = renderList({ viewerAdoId });

    expect(row(/Rev One/i)).toHaveAttribute("aria-disabled", "true");
    expect(row(/Rev Two/i)).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(row(/Rev One/i));
    expect(onToggleOwn).not.toHaveBeenCalled();
  });
});

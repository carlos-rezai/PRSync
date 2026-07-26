import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";
import {
  REVIEWER_ONE_ID,
  REVIEWER_TWO_ID,
  makeCancelledRound,
  makeClosedRound,
  makeReviewer,
  makeRound,
} from "../../test/fixtures/fixtures";

// The round-status summary (panel-layout-spec.md, row 5). Nothing about
// it is stored — every word is derived from the round's own reviewer
// snapshot, which is why it can be asserted purely from props.
//
// The count is deliberately over the SNAPSHOT, not over the quorum: "1 of
// 2 reviewed" answers "how far has this round got", and quorum answers
// "what closes it". A round can close on quorum with a reviewer still
// pending, and at that point the pill stops counting and says so.

describe("StatusPill", () => {
  it("counts the reviewers marked done while the round is open", () => {
    render(<StatusPill round={makeRound()} />);

    expect(screen.getByText("1 of 2 reviewed")).toBeInTheDocument();
  });

  it("counts none when no reviewer has signalled yet", () => {
    const round = makeRound({
      reviewers: [
        makeReviewer({ adoId: REVIEWER_ONE_ID, displayName: "Rev One" }),
        makeReviewer({ adoId: REVIEWER_TWO_ID, displayName: "Rev Two" }),
      ],
    });
    render(<StatusPill round={round} />);

    expect(screen.getByText("0 of 2 reviewed")).toBeInTheDocument();
  });

  it("says 'All reviewed' once the round has closed", () => {
    render(<StatusPill round={makeClosedRound()} />);

    expect(screen.getByText("All reviewed")).toBeInTheDocument();
  });

  it("says 'All reviewed' on a closed round even with a reviewer still pending", () => {
    // Close is on QUORUM, not unanimity — the third reviewer's Done simply
    // froze. The pill reports the round's state, not a headcount.
    const closedOnQuorum = makeClosedRound({
      reviewers: [
        makeReviewer({
          adoId: REVIEWER_ONE_ID,
          displayName: "Rev One",
          done: true,
        }),
        makeReviewer({ adoId: REVIEWER_TWO_ID, displayName: "Rev Two" }),
      ],
    });
    render(<StatusPill round={closedOnQuorum} />);

    expect(screen.getByText("All reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ reviewed/)).not.toBeInTheDocument();
  });

  it("says 'Cancelled' on a cancelled round, never a count", () => {
    // A cancelled round was abandoned, so how far it got is not the
    // question — and it must never read as if it completed.
    render(<StatusPill round={makeCancelledRound()} />);

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText(/reviewed/i)).not.toBeInTheDocument();
  });
});

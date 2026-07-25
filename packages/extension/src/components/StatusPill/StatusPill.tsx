import * as React from "react";
import { Pill } from "azure-devops-ui/Pill";
import type { Round } from "../../lib";

// The derived round-status summary (panel-layout-spec.md, row 5) — never
// stored, always computed from the reviewer snapshot: "N of M reviewed"
// while the round is open, "All reviewed" once it has closed.
export function StatusPill({ round }: { round: Round }): React.ReactElement {
  const total = round.reviewers.length;
  const doneCount = round.reviewers.filter((reviewer) => reviewer.done).length;
  const text =
    round.status === "closed"
      ? "All reviewed"
      : round.status === "cancelled"
        ? "Cancelled"
        : `${doneCount} of ${total} reviewed`;
  return <Pill>{text}</Pill>;
}

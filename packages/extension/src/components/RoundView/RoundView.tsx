import * as React from "react";
import type { Phase, Round } from "../../lib";
import { PanelHeader } from "../PanelHeader/PanelHeader";
import { ReviewerList } from "../ReviewerList/ReviewerList";
import { StatusPill } from "../StatusPill/StatusPill";

// The read-only view of a present round (a `200` from getCurrentRound):
// header, round label in display mode, phase, the reviewer list, and the
// derived status pill. No control mutates anything in Phase 1 — the
// author/reviewer/bystander views are identical here and diverge in
// later phases as interactive controls are unlocked.

const PHASE_TEXT: Record<Phase, string> = {
  spec: "Use Case Review",
  implementation: "Implementation Review",
};

export function RoundView({ round }: { round: Round }): React.ReactElement {
  return (
    <div className="prsync-panel flex-column rhythm-vertical-8">
      <PanelHeader />
      <div className="prsync-round-label title-m">{round.label}</div>
      <div className="prsync-phase secondary-text">
        {PHASE_TEXT[round.phase]}
      </div>
      <ReviewerList reviewers={round.reviewers} />
      <StatusPill round={round} />
    </div>
  );
}

import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { Phase, Round } from "../../lib";
import { PanelHeader } from "../PanelHeader/PanelHeader";
import { ReviewerList } from "../ReviewerList/ReviewerList";
import { StatusPill } from "../StatusPill/StatusPill";

// The view of a present round (a `200` from getCurrentRound): header,
// round label, phase, the reviewer list, and the derived status pill.
// The list's own-row Done checkbox becomes interactive when the viewer is
// a reviewer on an open round (`canToggleOwn`); the `App` owns the
// optimistic flip and reconcile. A failed toggle surfaces `toggleError`
// as an inline recovery `MessageCard`.

const PHASE_TEXT: Record<Phase, string> = {
  spec: "Use Case Review",
  implementation: "Implementation Review",
};

export function RoundView({
  round,
  viewerAdoId,
  onToggleOwn,
  toggleError,
}: {
  round: Round;
  viewerAdoId: string;
  onToggleOwn: () => void;
  toggleError: string | null;
}): React.ReactElement {
  const canToggleOwn =
    round.status === "open" &&
    round.reviewers.some((reviewer) => reviewer.adoId === viewerAdoId);

  return (
    <div className="prsync-panel flex-column rhythm-vertical-8">
      <PanelHeader />
      <div className="prsync-round-label title-m">{round.label}</div>
      <div className="prsync-phase secondary-text">
        {PHASE_TEXT[round.phase]}
      </div>
      <ReviewerList
        reviewers={round.reviewers}
        viewerAdoId={viewerAdoId}
        canToggleOwn={canToggleOwn}
        onToggleOwn={onToggleOwn}
      />
      <StatusPill round={round} />
      {toggleError !== null && (
        <MessageCard severity={MessageCardSeverity.Error}>
          {toggleError}
        </MessageCard>
      )}
    </div>
  );
}

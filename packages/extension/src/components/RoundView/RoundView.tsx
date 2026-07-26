import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { Phase, Round } from "../../lib";
import { CancelRoundControl } from "../CancelRoundControl/CancelRoundControl";
import { PanelHeader } from "../PanelHeader/PanelHeader";
import { ReviewerList } from "../ReviewerList/ReviewerList";
import { RoundLabel } from "../RoundLabel/RoundLabel";
import { StatusPill } from "../StatusPill/StatusPill";

// The view of a present round (a `200` from getCurrentRound): header,
// round label, phase, the reviewer list, and the derived status pill.
// What this component owns is COMPOSITION — which of its children are
// live, for whom — rather than any behaviour of its own.
//
// Three interactions hang off it, each gated on an OPEN round: the own-row
// Done checkbox becomes interactive for a reviewer (`canToggleOwn`), and
// the label field plus the Cancel round control appear for the author
// (`canManage`). Every terminal round is frozen for everyone. The `App`
// owns all three mutations; a failure from any of them surfaces here as
// one inline recovery `MessageCard` (`mutationError`).

const PHASE_TEXT: Record<Phase, string> = {
  spec: "Use Case Review",
  implementation: "Implementation Review",
};

export function RoundView({
  round,
  viewerAdoId,
  onToggleOwn,
  onEditLabel,
  onCancelRound,
  mutationError,
}: {
  round: Round;
  viewerAdoId: string;
  onToggleOwn: () => void;
  onEditLabel: (label: string) => void;
  onCancelRound: () => void;
  mutationError: string | null;
}): React.ReactElement {
  const isOpen = round.status === "open";
  const canToggleOwn =
    isOpen &&
    round.reviewers.some((reviewer) => reviewer.adoId === viewerAdoId);
  const canManage = isOpen && viewerAdoId === round.authorAdoId;

  return (
    <div className="prsync-panel flex-column rhythm-vertical-8">
      <PanelHeader />
      {/* Keyed on the stored label so the round the API returns replaces
          any draft the author left in the field. */}
      <RoundLabel
        key={round.label}
        label={round.label}
        editable={canManage}
        onCommit={onEditLabel}
      />
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
      {canManage && <CancelRoundControl onCancelRound={onCancelRound} />}
      {mutationError !== null && (
        <MessageCard severity={MessageCardSeverity.Error}>
          {mutationError}
        </MessageCard>
      )}
    </div>
  );
}

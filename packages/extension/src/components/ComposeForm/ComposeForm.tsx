import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { TextField } from "azure-devops-ui/TextField";
import { deriveDefaultLabel } from "../../lib";
import type { Phase } from "../../lib";
import { PanelHeader } from "../PanelHeader/PanelHeader";

// What the author sees when no round is open — a `204`, or a terminal
// (closed/cancelled) round they can follow with the next one. Replaces the
// read-only view for the author (panel-layout-spec.md rows 2, 3, 6).
//
// The form owns only its two presentation values: the chosen phase
// (pre-set to `defaultPhase` — the previous round's phase, or `spec`) and
// the label. The label field shows the derived default until the author
// types; while untouched it stays `null` and submits as `undefined`, so
// the API generates the canonical wording and the panel and DB can never
// diverge (PRD #7 "Compose defaults"). Every rule beyond that — reading
// ADO afresh, calling `openRound`, error recovery — belongs to the `App`.

const PHASE_OPTIONS: ReadonlyArray<{ phase: Phase; text: string }> = [
  { phase: "spec", text: "Use Case Review" },
  { phase: "implementation", text: "Implementation Review" },
];

export function ComposeForm({
  nextRoundNumber,
  defaultPhase,
  canOpen,
  submitting,
  openError,
  onOpenRound,
}: {
  nextRoundNumber: number;
  defaultPhase: Phase;
  canOpen: boolean;
  submitting: boolean;
  openError: string | null;
  onOpenRound: (phase: Phase, label: string | undefined) => void;
}): React.ReactElement {
  const [phase, setPhase] = React.useState<Phase>(defaultPhase);
  // `null` means untouched — the field shows the derived default (which
  // follows the phase toggle) and the label is omitted on submit.
  const [editedLabel, setEditedLabel] = React.useState<string | null>(null);

  const label = editedLabel ?? deriveDefaultLabel(nextRoundNumber, phase);

  return (
    <div className="prsync-panel flex-column rhythm-vertical-8">
      <PanelHeader />
      <div className="prsync-compose-empty secondary-text">
        No open round. Start one when the PR is ready for review.
      </div>
      <TextField
        label="Round label"
        value={label}
        onChange={(_event, value) => setEditedLabel(value)}
      />
      <div className="prsync-phase-toggle flex-row rhythm-horizontal-8">
        {PHASE_OPTIONS.map((option) => (
          <Button
            key={option.phase}
            text={option.text}
            primary={option.phase === phase}
            ariaPressed={option.phase === phase}
            onClick={() => setPhase(option.phase)}
          />
        ))}
      </div>
      <Button
        className="prsync-ready-button"
        text="Ready for review"
        primary={true}
        disabled={!canOpen || submitting}
        onClick={() => onOpenRound(phase, editedLabel ?? undefined)}
      />
      {!canOpen && (
        <div className="prsync-compose-hint secondary-text">
          Add an eligible reviewer to this PR in Azure DevOps before opening a
          round.
        </div>
      )}
      {openError !== null && (
        <MessageCard severity={MessageCardSeverity.Error}>
          {openError}
        </MessageCard>
      )}
    </div>
  );
}

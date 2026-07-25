import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Persona, PersonaSize } from "azure-devops-ui/Persona";
import type { RoundReviewer } from "../../lib";

// The reviewer status list (panel-layout-spec.md, row 4). One row per
// reviewer in the round's frozen open-time snapshot — a `Persona` coin,
// the display name, and a Done `Checkbox`. Only the viewer's OWN row is
// interactive, and only while the round is open (`canToggleOwn`); every
// other row — and all rows for the author and bystander — stays
// read-only. The click flips optimistically in the `App`, never here.
export function ReviewerList({
  reviewers,
  viewerAdoId,
  canToggleOwn,
  onToggleOwn,
}: {
  reviewers: RoundReviewer[];
  viewerAdoId: string;
  canToggleOwn: boolean;
  onToggleOwn: () => void;
}): React.ReactElement {
  return (
    <Card className="prsync-reviewer-card">
      <div className="flex-column" role="list">
        {reviewers.map((reviewer) => {
          const interactive = canToggleOwn && reviewer.adoId === viewerAdoId;
          return (
            <div
              key={reviewer.adoId}
              role="listitem"
              className="prsync-reviewer-row flex-row flex-center"
            >
              <Persona
                identity={{
                  id: reviewer.adoId,
                  displayName: reviewer.displayName,
                }}
                size={PersonaSize.size24}
              />
              <span className="prsync-reviewer-name flex-grow">
                {reviewer.displayName}
              </span>
              <Checkbox
                checked={reviewer.done}
                disabled={!interactive}
                onChange={interactive ? () => onToggleOwn() : undefined}
                ariaLabel={`${reviewer.displayName} marked done`}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

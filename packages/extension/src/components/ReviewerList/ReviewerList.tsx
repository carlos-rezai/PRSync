import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Persona, PersonaSize } from "azure-devops-ui/Persona";
import type { RoundReviewer } from "../../lib";

// The reviewer status list (panel-layout-spec.md, row 4). One row per
// reviewer in the round's frozen open-time snapshot — a `Persona` coin,
// the display name, and a Done `Checkbox`. Every checkbox is read-only in
// Phase 1; interactivity for the viewer's own row arrives in Phase 2.
export function ReviewerList({
  reviewers,
}: {
  reviewers: RoundReviewer[];
}): React.ReactElement {
  return (
    <Card className="prsync-reviewer-card">
      <div className="flex-column" role="list">
        {reviewers.map((reviewer) => (
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
              disabled
              ariaLabel={`${reviewer.displayName} marked done`}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

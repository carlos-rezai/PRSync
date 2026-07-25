import * as React from "react";
import { PanelHeader } from "../PanelHeader/PanelHeader";

// What the author sees on a `204` (no round yet): the panel chrome plus a
// prompt to open the first round. The actual "Ready for review" compose
// controls arrive in Phase 3; Phase 1 shows only the placeholder. This is
// deliberately NOT the bystander `ZeroData` "No round yet" empty state.
export function ComposePlaceholder(): React.ReactElement {
  return (
    <div className="prsync-panel flex-column rhythm-vertical-8">
      <PanelHeader />
      <div className="prsync-compose-empty secondary-text">
        No open round. Start one when the PR is ready for review.
      </div>
    </div>
  );
}

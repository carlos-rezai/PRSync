import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";

// Panel row 8 (docs/handoff/panel-layout-spec.md): the conditional refresh
// banner, shown only once polling has found that someone ELSE changed the
// round the viewer is reading (a `roundFingerprint` divergence from their
// baseline).
//
// The panel never silently live-patches state under a cursor, so this
// banner is the whole update path for a drifted panel: informational
// severity, and one action the viewer must click. The re-fetch and the
// baseline reset belong to the `App`.

export function RefreshBanner({
  onRefresh,
}: {
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <MessageCard
      className="prsync-refresh-banner"
      severity={MessageCardSeverity.Info}
      buttonProps={[{ text: "Refresh", onClick: onRefresh }]}
    >
      This round changed since you loaded it.
    </MessageCard>
  );
}

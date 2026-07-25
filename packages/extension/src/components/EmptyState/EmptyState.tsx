import * as React from "react";
import { ZeroData } from "azure-devops-ui/ZeroData";

// A native `ZeroData` empty state, reused for the two Phase 1 empties: a
// round with no reviewers, and a bystander viewing a PR with no round yet
// (panel-layout-spec.md "Empty").
export function EmptyState({
  primaryText,
  secondaryText,
}: {
  primaryText: string;
  secondaryText?: string;
}): React.ReactElement {
  return (
    <ZeroData
      imageAltText=""
      primaryText={primaryText}
      secondaryText={secondaryText}
    />
  );
}

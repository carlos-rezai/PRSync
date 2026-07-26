import * as React from "react";
import { ZeroData } from "azure-devops-ui/ZeroData";

// A native `ZeroData` empty state, shared by the panel's two empties: a
// round with no tracked reviewers, and a bystander viewing a PR on which
// no round has been opened (panel-layout-spec.md "Empty"). The secondary
// text is the caller's to supply — an empty does not always deserve an
// explanation.
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

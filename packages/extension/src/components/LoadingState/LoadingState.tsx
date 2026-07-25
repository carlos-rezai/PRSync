import * as React from "react";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";

// The initial-load state: a native `Spinner` while the first
// getCurrentRound is in flight (panel-layout-spec.md "Loading").
export function LoadingState(): React.ReactElement {
  return <Spinner label="Loading…" size={SpinnerSize.large} />;
}

import * as React from "react";
import { Header } from "azure-devops-ui/Header";

// The static panel title. Native `azure-devops-ui` `Header` so the panel
// reads as part of the host PR page (panel-layout-spec.md, row 1).
export function PanelHeader(): React.ReactElement {
  return <Header title="PRSync" />;
}

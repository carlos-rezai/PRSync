// PRSync ADO extension entry point.
//
// Boot glue that runs inside the Azure DevOps pull request page iframe:
// it initializes the extension SDK, constructs the real host-backed
// `sdk` / `api` / `ado` clients, and mounts the `App` container with them
// injected. All behavior lives in `App` and the layers it wires; this
// file is intentionally untested boot wiring.

import * as React from "react";
import { createRoot } from "react-dom/client";
import * as SDK from "azure-devops-extension-sdk";
import "azure-devops-ui/Core/core.css";
import { createSdkClient } from "./sdk";
import { createApiClient } from "./api";
import { createAdoClient } from "./ado";
import { App } from "./App/App";

async function boot(): Promise<void> {
  await SDK.init();
  await SDK.ready();

  const baseUrl: string | undefined = import.meta.env.VITE_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("PRSync panel: VITE_API_BASE_URL is not configured");
  }

  const sdk = createSdkClient();
  const api = createApiClient(baseUrl, () => sdk.getAccessToken());
  const ado = createAdoClient();

  const container = document.getElementById("root");
  if (!container) {
    throw new Error("PRSync panel: #root container not found");
  }

  createRoot(container).render(<App sdk={sdk} api={api} ado={ado} />);
}

void boot();

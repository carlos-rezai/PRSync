import * as SDK from "azure-devops-extension-sdk";

// The panel's handshake with its ADO host, kept in the `sdk/` seam so
// index.tsx stays pure boot glue and `azure-devops-extension-sdk` still has
// exactly one importer per module in this layer.
//
// `applyTheme` is the whole of "the panel respects ADO's theme": the host
// does NOT theme an extension frame by default. Opting in makes ADO cascade
// its active light/dark palette into the iframe as CSS custom properties,
// which is what `azure-devops-ui` and the panel's own classes read. Skipping
// it is exactly what strands a glaring white panel inside a dark ADO.

/**
 * Opens the channel to the ADO host with the theme cascade enabled, then
 * reports the panel loaded. `ready` can only follow `init`, which is what
 * established the channel in the first place.
 */
export async function initPanel(): Promise<void> {
  await SDK.init({ applyTheme: true });
  await SDK.ready();
}

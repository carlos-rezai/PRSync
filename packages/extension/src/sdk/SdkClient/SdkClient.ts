import * as SDK from "azure-devops-extension-sdk";
import type { PrKeyParts } from "../../lib";

// The `sdk/` seam: the ONLY module that imports
// `azure-devops-extension-sdk`. Everything the panel needs from the ADO
// host is funnelled through this narrow interface so the `App` container
// can be driven by a plain fake in tests (no SDK mocking).

export interface SdkUser {
  /** The viewer's ADO GUID (== adoId). Used only to select a view. */
  id: string;
  displayName: string;
}

export interface SdkClient {
  getUser(): SdkUser;
  /** The PR key parts resolved from the tab's contribution context. */
  prKeyParts(): PrKeyParts;
  /** The caller's ADO bearer token for authenticating PRSync API calls. */
  getAccessToken(): Promise<string>;
  /**
   * Asks the host to size the extension's iframe to what the panel
   * currently renders. The HOST owns that height — nothing the panel draws
   * changes it — so a panel that never asks is clipped when it grows and
   * leaves dead space when it shrinks.
   */
  resize(): void;
}

// The contribution configuration ADO hands the PR-detail tab. Typed
// locally (rather than reaching into `getConfiguration()`'s index
// signature untyped) so the panel never leans on `any`.
interface PrTabConfiguration {
  pullRequestId?: number;
  repositoryId?: string;
  projectId?: string;
}

/**
 * Constructs the real, host-backed SDK client. Boot glue — exercised
 * against a live ADO iframe, not in unit tests (which inject a fake).
 */
export function createSdkClient(): SdkClient {
  return {
    getUser() {
      const user = SDK.getUser();
      return { id: user.id, displayName: user.displayName };
    },
    prKeyParts() {
      const config = SDK.getConfiguration() as PrTabConfiguration;
      const projectId = config.projectId ?? SDK.getWebContext().project.id;
      const repositoryId = config.repositoryId;
      const pullRequestId = config.pullRequestId;
      if (repositoryId === undefined || pullRequestId === undefined) {
        throw new Error(
          "PRSync panel: PR context missing from contribution configuration"
        );
      }
      return { projectId, repositoryId, pullRequestId };
    },
    getAccessToken() {
      return SDK.getAccessToken();
    },
    resize() {
      // No dimensions: passing them would pin the frame to a height the
      // panel guessed at. Omitting them is what makes the host measure the
      // content it is actually showing.
      SDK.resize();
    },
  };
}

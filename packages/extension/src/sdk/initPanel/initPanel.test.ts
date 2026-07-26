import { describe, it, expect, vi, beforeEach } from "vitest";
import * as SDK from "azure-devops-extension-sdk";
import { initPanel } from "./initPanel";

// The panel's handshake with its ADO host, isolated in the `sdk/` seam so
// index.tsx stays pure boot glue.
//
// `azure-devops-extension-sdk` is the one third-party system boundary the
// panel talks to, so it is mocked HERE and nowhere else (mocking.md:
// boundaries only) — every other layer receives the seam as an injected
// fake.
//
// The behaviour that matters: ADO does not theme an extension frame by
// default. The host cascades its light/dark palette into the iframe only
// when the panel opts in at init; skipping the opt-in is exactly what
// leaves a panel glaring white inside a dark ADO. The opt-in is therefore
// not boot trivia — it is the whole of "the panel respects ADO's theme".

vi.mock("azure-devops-extension-sdk", () => ({
  init: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
}));

describe("initPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opts into the host's light/dark theme cascade", async () => {
    await initPanel();

    expect(vi.mocked(SDK.init)).toHaveBeenCalledWith(
      expect.objectContaining({ applyTheme: true })
    );
  });

  it("completes the host handshake before reporting the panel ready", async () => {
    await initPanel();

    expect(vi.mocked(SDK.ready)).toHaveBeenCalledTimes(1);

    // `ready` tells the host the panel has finished loading, so it can only
    // follow the init that established the channel.
    const initCall = vi.mocked(SDK.init).mock.invocationCallOrder[0] as number;
    const readyCall = vi.mocked(SDK.ready).mock
      .invocationCallOrder[0] as number;
    expect(initCall).toBeLessThan(readyCall);
  });
});

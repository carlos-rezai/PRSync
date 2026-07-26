import { describe, it, expect, vi, beforeEach } from "vitest";
import * as SDK from "azure-devops-extension-sdk";
import { createSdkClient } from "./SdkClient";

// The `sdk/` seam is the only module that touches
// `azure-devops-extension-sdk`, so the SDK is mocked here — the third-party
// system boundary — while every other layer drives the seam through an
// injected fake (mocking.md: boundaries only).
//
// The behaviour under test is `resize`. An ADO extension renders in an
// iframe the HOST sizes: nothing the panel draws changes that height on
// its own, so a panel that never asks is clipped when it grows and leaves
// dead space when it shrinks. The panel must ask the host to size the
// frame to what it currently renders — MEASURED by the host, never a
// height the panel guesses at, which is why the call passes no
// dimensions.

vi.mock("azure-devops-extension-sdk", () => ({
  resize: vi.fn(),
  getUser: vi.fn(),
  getConfiguration: vi.fn(),
  getWebContext: vi.fn(),
  getAccessToken: vi.fn(),
}));

describe("SdkClient — resize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the host to size the frame to the panel's content", () => {
    createSdkClient().resize();

    // No explicit dimensions: passing width/height would pin the frame to a
    // number the panel guessed, which is the bug this replaces. Omitting
    // them is what makes the host measure the rendered content.
    expect(vi.mocked(SDK.resize)).toHaveBeenCalledWith();
  });
});

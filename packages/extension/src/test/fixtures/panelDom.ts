import { act, screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";

// Queries and interactions over the RENDERED panel, shared by the App
// container's behaviour test files (load / mutations / polling / errors /
// host). They name what a viewer sees and does — "the own-row checkbox",
// "confirm the cancel dialog", "one poll interval passes" — so a test
// reads as behaviour rather than as `azure-devops-ui` markup trivia.
//
// Nothing here asserts. Each helper either finds an element or drives the
// clock, and the test that calls it owns the expectation.

/** The poll cadence the panel runs on, within the layout spec's 15–30s. */
export const POLL_MS = 20_000;

/**
 * A reviewer's Done checkbox. `azure-devops-ui` renders it with
 * `role="checkbox"` and an aria-label carrying the display name, so a test
 * addresses a row by who is in it.
 */
export function checkbox(name: RegExp): HTMLElement {
  return screen.getByRole("checkbox", { name });
}

/** The compose form's primary action. */
export function readyButton(): HTMLElement {
  return screen.getByRole("button", { name: /ready for review/i });
}

/**
 * Confirms the open "Cancel round?" dialog. Scoped to the dialog because
 * the trigger and the confirm button are both named "Cancel round".
 */
export function confirmCancel(dialog: HTMLElement): void {
  fireEvent.click(
    within(dialog).getByRole("button", { name: /cancel round/i })
  );
}

/** The refresh banner's action, or `null` while the panel is in sync. */
export function refreshBanner(): HTMLElement | null {
  return screen.queryByRole("button", { name: /refresh/i });
}

/** Lets pending promise chains settle and their React updates land. */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
  });
}

/** Advances whole poll intervals, then settles what they kicked off. */
export async function tickPoll(intervals = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * intervals);
  });
  await flush();
}

/** Drives the Page Visibility API the way a real tab switch would. */
export function setTabVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: state === "hidden",
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

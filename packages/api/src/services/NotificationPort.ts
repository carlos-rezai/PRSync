import type { Round } from "../lib";

// The domain-language seam the round lifecycle calls to trigger DMs.
// In v1 this is a no-op stub; Feature 3 supplies the real Bot Framework
// adapter behind the same interface without touching lifecycle logic.
// Failures are the caller's concern to isolate — a port must never roll
// back or fail a committed round transition.

export interface NotificationPort {
  roundOpened(round: Round): Promise<void>;
  roundClosed(round: Round): Promise<void>;
}

/** v1 stub: does nothing. Replaced by the bot adapter in Feature 3. */
export class NoopNotificationPort implements NotificationPort {
  async roundOpened(): Promise<void> {
    // no-op
  }

  async roundClosed(): Promise<void> {
    // no-op
  }
}

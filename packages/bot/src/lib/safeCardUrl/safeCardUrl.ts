// `prUrl` reaches the card's `Action.OpenUrl` from the round-open request
// body, which means it is attacker-controlled by the time the bot sees
// it. A button in a message from PRSync is exactly what a person clicks
// without reading, so the scheme is checked here and the builder omits
// the action entirely when this yields nothing — a notification with no
// button is a smaller failure than a notification with a hostile one.

/**
 * `url` unchanged if it is an `https:` URL, and nothing otherwise.
 *
 * The scheme is read with the same URL parser a renderer uses rather
 * than with a pattern, so the tricks that hide one from a pattern —
 * padding, casing, a newline inside `java\nscript:` — cannot hide one
 * from this.
 *
 * The value is checked, never rewritten: an ADO PR URL carries branch
 * names and percent-encoded paths that survive a round trip through
 * `new URL` only by luck, so what comes back is the caller's own string
 * with surrounding whitespace removed.
 */
export function safeCardUrl(url: string): string | undefined {
  const trimmed = url.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not absolute, so there is no scheme to trust — `//evil.example`
    // and `not a url at all` both land here.
    return undefined;
  }

  return parsed.protocol === "https:" ? trimmed : undefined;
}

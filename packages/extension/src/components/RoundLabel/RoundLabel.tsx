import * as React from "react";
import { TextField } from "azure-devops-ui/TextField";

// Panel row 2 (docs/handoff/panel-layout-spec.md): the round label — an
// inline `TextField` for the author while the round is `open`, plain
// display text for everyone else and for every terminal round.
//
// The field is controlled by a local draft that starts as `null`
// (untouched, showing the stored label). Blur and Enter both commit, and
// they hand up the EXACT text the author typed — no re-derivation into
// the canonical wording. An unchanged value commits nothing. The typed
// text is already on screen, so there is nothing optimistic to revert;
// `RoundView` re-keys this component on the stored label, which is how
// the round the API returns replaces a stale draft.

export function RoundLabel({
  label,
  editable,
  onCommit,
}: {
  label: string;
  editable: boolean;
  onCommit: (label: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = React.useState<string | null>(null);

  if (!editable) {
    return <div className="prsync-round-label title-m">{label}</div>;
  }

  function commit(): void {
    if (draft === null || draft === label) {
      return;
    }
    onCommit(draft);
  }

  return (
    <TextField
      className="prsync-round-label"
      ariaLabel="Round label"
      value={draft ?? label}
      onChange={(_event, value) => setDraft(value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
    />
  );
}

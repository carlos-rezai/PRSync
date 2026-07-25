# PRSync ADO Extension Panel — Component Layout Spec

Handoff artifact in place of a Claude Design prototype. Decided during
grill-me that the panel is constrained enough (must use `azure-devops-ui`
to look native inside the ADO PR page) that a visual mockup would just
get re-translated into these components anyway.

Contributed as an `ms.vss-web.tab` on `ms.vss-code-web.pr-detail-page`
(see `packages/extension/vss-extension.json`).

Top to bottom:

| Order | Component                    | `azure-devops-ui` element                                      | Behavior                                                                                                                                                            |
| ----- | ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Panel header                 | `Header` + `HeaderTitleArea`                                   | Static title: "PRSync"                                                                                                                                              |
| 2     | Round label                  | `TextField` (edit mode, author only) / `HeaderTitle` (display) | Auto-filled from round number + phase, editable by author only                                                                                                      |
| 3     | Phase toggle                 | `ButtonGroup` (two `Button`s, one active)                      | "Use Case Review" / "Implementation Review" — author-set when opening a round                                                                                       |
| 4     | Reviewer status list         | `Card` containing rows of `Persona` + `Checkbox`               | One row per mirrored ADO reviewer. Each reviewer can only toggle their own row; others render read-only                                                             |
| 5     | Round status summary         | `Pill` (neutral while open, success when closed)               | Derived only — e.g. "2 of 3 reviewed" / "All reviewed"                                                                                                              |
| 6     | Ready for review button      | `Button` (`primary: true`)                                     | Author-only. Enabled only when the round is closed or none exists. Opens next round, snapshots reviewer list + label, fires Teams DM                                |
| 7     | Cancel round button          | `Button` (secondary/danger) + confirm `Dialog`                 | Author-only, visible only while a round is `open`. Abandons the round (`cancelRound`); silent — no Teams DM. Added in `docs/design-logs/02-extension-panel.md` (Q6) |
| 8     | Refresh banner (conditional) | `MessageCard` (severity: info) with action                     | Appears only when background polling (15–30s) detects state drift. User must click to re-render — no silent live-patch                                              |

## States to design for

- **Loading**: `Spinner` while initial GET resolves
- **Empty**: `ZeroData` if a PR somehow has no reviewers
- **Round open, author view**: label editable, phase toggle editable, Ready for review disabled until round closes
- **Round open, reviewer view**: label/phase read-only, only own Done checkbox interactive
- **Round closed**: all checkboxes frozen (no un-toggle by anyone), Ready for review enabled for author

## Explicitly deferred (v1 scope)

- Round history / past rounds view
- Live push updates (SignalR) — polling + manual refresh banner only

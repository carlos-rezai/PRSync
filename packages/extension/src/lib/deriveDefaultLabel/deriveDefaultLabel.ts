import type { Phase } from "../types/types";

// The canonical round label the panel pre-fills in the compose form.
// Reproduces the API's generateLabel format byte-for-byte (em dash,
// title-cased phase) so the panel and DB never diverge on wording. See
// packages/api/src/lib/label and docs/ubiquitous-language.md
// ("Round label").

const PHASE_LABEL: Record<Phase, string> = {
  spec: "Spec",
  implementation: "Implementation",
};

export function deriveDefaultLabel(roundNumber: number, phase: Phase): string {
  return `Round ${roundNumber} — ${PHASE_LABEL[phase]} Review`;
}

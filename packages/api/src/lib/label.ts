import type { Phase } from "./types/types";

// The auto-generated round label reviewers see when the author does not
// type one. Format follows the ubiquitous-language example exactly:
// "Round 2 — Implementation Review" (em dash, title-cased phase).

const PHASE_LABEL: Record<Phase, string> = {
  spec: "Spec",
  implementation: "Implementation",
};

export function generateLabel(roundNumber: number, phase: Phase): string {
  return `Round ${roundNumber} — ${PHASE_LABEL[phase]} Review`;
}

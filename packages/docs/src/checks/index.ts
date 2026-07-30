// Barrel for the checks layer — the layer's public API.
//
// Each check takes a `Repo` and RETURNS findings; none of them asserts.
// That is what makes every one of them testable against a fake repository
// with no reference to this project's actual files — and the failures they
// guard against, a missing file or an anchor matching nothing, are exactly
// what a correct repository cannot demonstrate.
//
// Cross-layer consumers import from "../../checks", never from a module's
// internal file. Within-layer siblings import each other by direct path,
// never through this barrel, to avoid import cycles. See .claude/CLAUDE.md.

export * from "./unresolvedLinks/unresolvedLinks";

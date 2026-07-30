// Barrel for the repo layer — the layer's public API.
//
// The ONLY layer that performs I/O. Everything else in this workspace
// takes a `Repo`, which is what keeps every check drivable against a fake
// with no reference to this repository's actual files.
//
// Cross-layer consumers import from "../../repo", never from a module's
// internal file. Within-layer siblings import each other by direct path,
// never through this barrel, to avoid import cycles. See .claude/CLAUDE.md.

export * from "./readDocument/readDocument";
export * from "./repoAt/repoAt";

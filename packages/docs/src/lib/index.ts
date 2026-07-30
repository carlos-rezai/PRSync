// Barrel for the lib layer — the layer's public API.
//
// The LEAF layer: pure text over markdown. It imports no other layer,
// touches no filesystem, and every function in it has a test.
//
// Cross-layer consumers import from "../../lib", never from a module's
// internal file. Within-layer siblings import each other by direct path,
// never through this barrel, to avoid import cycles. See .claude/CLAUDE.md.

export * from "./fences/fences";
export * from "./githubSlug/githubSlug";
export * from "./section/section";

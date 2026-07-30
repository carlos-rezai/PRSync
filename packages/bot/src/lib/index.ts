// Barrel for the lib layer — the layer's public API.
//
// Cross-layer consumers import pure helpers and shared types from
// "../../lib", never from a module's internal file. Within-layer
// siblings import each other by direct path, never through this barrel,
// to avoid import cycles. See .claude/CLAUDE.md.

export * from "./dedupeKey/dedupeKey";
export * from "./escapeCardText/escapeCardText";
export * from "./normalizeEmail/normalizeEmail";
export * from "./safeCardUrl/safeCardUrl";
export * from "./statusCodeOf/statusCodeOf";
export * from "./types/types";

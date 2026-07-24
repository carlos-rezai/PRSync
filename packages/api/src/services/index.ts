// Barrel for the services layer — the layer's public API.
//
// Cross-layer consumers (functions/) import the round lifecycle service,
// the notification seam, and the identity-resolution seam from
// "../services" (or "../../services" once folderized), never from a
// module's internal file. See .claude/CLAUDE.md.

export * from "./RoundService/RoundService";
export * from "./NotificationPort/NotificationPort";
export * from "./IdentityResolver/IdentityResolver";

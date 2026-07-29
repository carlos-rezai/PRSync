// Barrel for the services layer — the layer's public API.
//
// Cross-layer consumers (teams/, functions/) import the identity
// directory from "../../services", never from a module's internal file.
// This layer is the only caller of storage/. See .claude/CLAUDE.md.

export * from "./IdentityDirectory/IdentityDirectory";
export * from "./NotificationDispatcher/NotificationDispatcher";

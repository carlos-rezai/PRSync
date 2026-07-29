// Barrel for the storage layer — the layer's public API.
//
// Cross-layer consumers (services/) import the repository contract and
// its implementation from "../storage" (or "../../storage" once
// folderized), never from a module's internal file. This is the only
// layer that touches @azure/data-tables directly. See .claude/CLAUDE.md.

export * from "./RoundRepository/RoundRepository";
export * from "./NotificationQueue/NotificationQueue";

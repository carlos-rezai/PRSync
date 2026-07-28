// Barrel for the storage layer — the layer's public API.
//
// Cross-layer consumers (services/, and the composition root) import the
// repository contract and its factory from "../../storage", never from a
// module's internal file. This is the only layer that touches
// @azure/data-tables directly. See .claude/CLAUDE.md.

export * from "./TeamsIdentityRepository/TeamsIdentityRepository";

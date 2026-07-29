// Barrel for the functions layer — the layer's public API.
//
// Each module is a thin HTTP entry point exposing a handler factory and
// the trigger options it is registered with. The composition root
// (src/index.ts) imports them from here, never from a module's internal
// file. See .claude/CLAUDE.md.

export * from "./notificationWorker/notificationWorker";
export * from "./teamsMessages/teamsMessages";

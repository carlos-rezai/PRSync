// Barrel for the teams layer — the layer's public API.
//
// This is the ONLY layer that imports `botbuilder`, the exact analogue
// of the extension's sdk/ layer. Cross-layer consumers (functions/, and
// the composition root) import the bot, its settings and the messaging
// endpoint from "../../teams", never from a module's internal file. See
// .claude/CLAUDE.md.

export * from "./BotConfig/BotConfig";
export * from "./BotHost/BotHost";
export * from "./MessagingEndpoint/MessagingEndpoint";
export * from "./TeamsBot/TeamsBot";
export * from "./TeamsSender/TeamsSender";

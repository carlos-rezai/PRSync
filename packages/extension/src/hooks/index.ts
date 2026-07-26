// Public API of the `hooks/` layer — the panel's state machine, lifted
// out of the container so `App` is left with rendering. The `App` imports
// `../hooks`; sibling modules within this layer import each other by
// direct file path, never through this barrel.
//
// The design log's package layout did not anticipate this layer; it was
// added during the issue #14 refactor rather than leaving a 474-line
// container. It follows every rule the other layers do — folder per
// module, exactly one barrel as the layer's public API, cross-layer
// imports through the target layer's barrel.

export * from "./usePanelState/usePanelState";

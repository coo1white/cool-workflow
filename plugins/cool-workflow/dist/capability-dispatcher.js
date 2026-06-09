"use strict";
// Capability Dispatcher — the thin MECHANISM pipe that routes a capability id
// to its registered handler function. It knows nothing about which capabilities
// exist (that's POLICY, declared elsewhere via registerCapabilityHandler).
//
// BSD discipline:
//  - ONE THING: map (capability id, args, ctx) -> handler output.
//  - SEPARATE MECHANISM FROM POLICY. The Map is mechanism; which entries are
//    registered is policy (callers registerCapabilityHandler at import time).
//  - FAIL CLOSED. Unknown capability id -> CapabilityError with a named refusal.
//  - COMPOSABLE. The dispatcher is a pure router; CLI and MCP surfaces compose
//    their own formatting/protocol wrapping around it. No surface knows how to
//    format — the handler returns raw data, the surface renders it.
//  - NO HIDDEN STATE. The registry is a plain Map; no lazy loading, no magic.
//
// From v0.1.53: this replaces the "manual switch in cli.ts + mcp-server.ts"
// anti-pattern for NEW capabilities. Existing hardcoded capabilities remain in
// the switch until they are progressively migrated; the fallback path in both
// surfaces first checks the switch, then falls through to this dispatcher.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCapabilityHandler = registerCapabilityHandler;
exports.getCapabilityHandler = getCapabilityHandler;
exports.dispatchCapability = dispatchCapability;
exports.resolveCliPath = resolveCliPath;
exports.resolveMcpTool = resolveMcpTool;
exports.listCapabilityIds = listCapabilityIds;
class CapabilityError extends Error {
    code;
    capabilityId;
    constructor(capabilityId, reason, code) {
        super(`Capability "${capabilityId}": ${reason}`);
        this.name = "CapabilityError";
        this.code = code;
        this.capabilityId = capabilityId;
    }
}
const _handlerRegistry = new Map();
/** Register a capability handler. Later registrations with the same capability
 *  id overwrite earlier ones (last-write-wins dedup). */
function registerCapabilityHandler(handler) {
    _handlerRegistry.set(handler.descriptor.capability, handler);
}
/** Look up a handler by capability id. Returns undefined when not found. */
function getCapabilityHandler(capabilityId) {
    return _handlerRegistry.get(capabilityId);
}
/** Dispatch a capability by id. Resolves the handler, invokes `run()`.
 *  Fail-closed: throws CapabilityError when no handler is registered. */
function dispatchCapability(capabilityId, args, ctx) {
    const handler = _handlerRegistry.get(capabilityId);
    if (!handler)
        throw new CapabilityError(capabilityId, "no handler registered", "not-found");
    return handler.run(args, ctx);
}
/** Resolve a CLI path (e.g. ["gc", "plan"]) to a capability id by matching
 *  registered handlers' `cli.path` bindings. Returns undefined when no match. */
function resolveCliPath(cliPath) {
    if (!cliPath.length)
        return undefined;
    for (const handler of _handlerRegistry.values()) {
        if (!handler.descriptor.cli)
            continue;
        const expected = handler.descriptor.cli.caseTokens || handler.descriptor.cli.path;
        if (pathsMatch(expected, cliPath))
            return handler.descriptor.capability;
    }
    return undefined;
}
/** Resolve an MCP tool name to a capability id by matching registered handlers'
 *  `mcp.tool` bindings. Returns undefined when no match. */
function resolveMcpTool(toolName) {
    for (const handler of _handlerRegistry.values()) {
        if (handler.descriptor.mcp?.tool === toolName)
            return handler.descriptor.capability;
    }
    return undefined;
}
/** List all registered capability ids. */
function listCapabilityIds() {
    return [..._handlerRegistry.keys()].sort();
}
function pathsMatch(expected, actual) {
    if (expected.length !== actual.length)
        return false;
    return expected.every((token, i) => actual[i] === token);
}

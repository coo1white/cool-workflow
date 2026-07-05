"use strict";
// mcp/dispatch.ts — the generic MCP tool-call reader over
// core/capability-table.ts.
//
// MILESTONE 2 (docs/rebuild/PLAN.md build order, step 2). Replaces the old build's
// 196-arm `callTool` switch (src/mcp/tool-call.ts) with a data-driven
// lookup: resolve the row by tool name, check its declared required-arg
// groups (SPEC/mcp.md's `McpBinding.requiredArgs`), re-base `cwd` if
// given, then call the row's `mcp.handler`. Every future milestone adds
// capabilities as capability-table ROWS; this file is not touched again.
//
// `cwd` handling here (resolve, must be a directory, inject the resolved
// path back into a COPY of args) matches SPEC/mcp.md invariant 7. This
// milestone's own real handlers (`list`, `sandbox.list`, `status`) do not
// themselves need cwd, but the re-base is still performed uniformly so a
// later milestone's handler can rely on it without dispatch.ts changing.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolDefinitions = toolDefinitions;
exports.requiredToolArguments = requiredToolArguments;
exports.callTool = callTool;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const capability_table_1 = require("../core/capability-table");
/** `toolDefinitions()` — the full, ordered `tools/list` array. */
function toolDefinitions() {
    return (0, capability_table_1.mcpToolDefinitions)();
}
/** SPEC/mcp.md invariant 6 / src/mcp-surface.ts:7-25 — required-argument
 *  groups are declared data, not code. `undefined`/`null` become `{}`; a
 *  non-object throws; a group "keyA|keyB" passes when at least one named
 *  key is not `undefined`, not `null`, and not `""`. */
function requiredToolArguments(name, value) {
    const args = value === undefined || value === null ? {} : value;
    if (typeof args !== "object" || Array.isArray(args)) {
        throw new Error(`MCP tool ${name} arguments must be an object.`);
    }
    const row = (0, capability_table_1.findCapabilityByMcpTool)(name);
    const requiredArgs = row?.mcp?.requiredArgs ?? [];
    for (const group of requiredArgs) {
        const keys = group.split("|");
        const satisfied = keys.some((key) => {
            const v = args[key];
            return v !== undefined && v !== null && v !== "";
        });
        if (!satisfied) {
            throw new Error(`MCP tool ${name} missing required argument: ${keys.join(" or ")}`);
        }
    }
    return args;
}
/** `callTool(name, args)` — resolves `cwd` (SPEC/mcp.md invariant 7),
 *  checks required args, then calls the row's `mcp.handler`. Throws
 *  `Unknown tool: <name>` for a name with no row (src/mcp/tool-call.ts:513
 *  parity). */
function callTool(name, rawArgs) {
    const row = (0, capability_table_1.findCapabilityByMcpTool)(name);
    if (!row || !row.mcp) {
        throw new Error(`Unknown tool: ${name}`);
    }
    const args = requiredToolArguments(name, rawArgs);
    const resolvedArgs = { ...args };
    const cwdInput = args.cwd;
    if (typeof cwdInput === "string" && cwdInput.length > 0) {
        const resolved = path.resolve(cwdInput);
        if (!fs.statSync(resolved).isDirectory()) {
            throw new Error(`MCP cwd is not a directory: ${resolved}`);
        }
        resolvedArgs.cwd = resolved;
    }
    return row.mcp.handler(resolvedArgs);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolDefinitions = exports.callTool = void 0;
exports.requiredToolArguments = requiredToolArguments;
const capability_registry_1 = require("./capability-registry");
const capability_core_1 = require("./capability-core");
var tool_call_1 = require("./mcp/tool-call");
Object.defineProperty(exports, "callTool", { enumerable: true, get: function () { return tool_call_1.callTool; } });
var tool_definitions_1 = require("./mcp/tool-definitions");
Object.defineProperty(exports, "toolDefinitions", { enumerable: true, get: function () { return tool_definitions_1.toolDefinitions; } });
function requiredToolArguments(name, value) {
    if (value === undefined || value === null)
        value = {};
    if (!(0, capability_core_1.isRecord)(value))
        throw new Error(`MCP tool ${name} arguments must be an object.`);
    const args = value;
    for (const group of requiredArgsForTool(name)) {
        const keys = group.split("|");
        if (!keys.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "")) {
            throw new Error(`MCP tool ${name} missing required argument: ${keys.join(" or ")}`);
        }
    }
    return args;
}
function requiredArgsForTool(name) {
    // Required args are declared once per capability as data on the mcp binding
    // (McpBinding.requiredArgs). This is a pure data read of the parity-gated
    // registry — no string-pattern ladder.
    return (0, capability_registry_1.mcpRequiredArgsForTool)(name);
}

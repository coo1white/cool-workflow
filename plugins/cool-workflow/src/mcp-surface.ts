import { mcpRequiredArgsForTool } from "./capability-registry";
import { isRecord } from "./capability-core";

export { callTool } from "./mcp/tool-call";
export { toolDefinitions } from "./mcp/tool-definitions";

export function requiredToolArguments(name: string, value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) value = {};
  if (!isRecord(value)) throw new Error(`MCP tool ${name} arguments must be an object.`);
  const args = value as Record<string, unknown>;
  for (const group of requiredArgsForTool(name)) {
    const keys = group.split("|");
    if (!keys.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "")) {
      throw new Error(`MCP tool ${name} missing required argument: ${keys.join(" or ")}`);
    }
  }
  return args;
}

function requiredArgsForTool(name: string): string[] {
  // Required args are declared once per capability as data on the mcp binding
  // (McpBinding.requiredArgs). This is a pure data read of the parity-gated
  // registry — no string-pattern ladder.
  return mcpRequiredArgsForTool(name);
}

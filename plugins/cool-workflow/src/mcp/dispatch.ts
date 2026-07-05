// mcp/dispatch.ts — the generic MCP tool-call reader over
// core/capability-table.ts.
//
// MILESTONE 2 (v2/PLAN.md build order, step 2). Replaces the old build's
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

import * as fs from "node:fs";
import * as path from "node:path";
import { findCapabilityByMcpTool, mcpToolDefinitions } from "../core/capability-table";
import type { McpToolDefinition } from "../core/capability-table";

/** `toolDefinitions()` — the full, ordered `tools/list` array. */
export function toolDefinitions(): McpToolDefinition[] {
  return mcpToolDefinitions();
}

/** SPEC/mcp.md invariant 6 / src/mcp-surface.ts:7-25 — required-argument
 *  groups are declared data, not code. `undefined`/`null` become `{}`; a
 *  non-object throws; a group "keyA|keyB" passes when at least one named
 *  key is not `undefined`, not `null`, and not `""`. */
export function requiredToolArguments(name: string, value: unknown): Record<string, unknown> {
  const args: Record<string, unknown> = value === undefined || value === null ? {} : (value as Record<string, unknown>);
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`MCP tool ${name} arguments must be an object.`);
  }
  const row = findCapabilityByMcpTool(name);
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
export function callTool(name: string, rawArgs: unknown): unknown {
  const row = findCapabilityByMcpTool(name);
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

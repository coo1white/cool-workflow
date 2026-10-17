// mcp/dispatch.ts — the generic MCP tool-call reader over
// core/capability-table.ts.
//
// A data-driven lookup: resolve the row by tool name, check its declared
// required-arg groups (SPEC/mcp.md's `McpBinding.requiredArgs`), re-base
// `cwd` if given, then call the row's `mcp.handler`. A new capability is a
// capability-table ROW; this file does not change for it.
//
// `cwd` handling here (resolve, must be a directory, inject the resolved
// path back into a COPY of args) matches SPEC/mcp.md invariant 7, and is
// performed uniformly so any handler can rely on it.

import * as fs from "node:fs";
import * as path from "node:path";
import { findCapabilityByMcpTool, mcpToolDefinitions } from "../core/capability-table";
import type { McpToolDefinition } from "../core/capability-table";
import { coerceMcpScalar } from "../core/util/cli-args";

/** `toolDefinitions()` — the full, ordered `tools/list` array. */
export function toolDefinitions(): McpToolDefinition[] {
  return mcpToolDefinitions();
}

/** SPEC/mcp.md invariant 6 — required-argument
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

/** MCP clients send JSON, so an argument the CLI would receive as a string
 *  can arrive as a number or boolean (e.g. `{"runId": 5}`). Every capability
 *  handler coerces its args through optionalString/numberArg/boolArg, all of
 *  which expect the CLI's string form — optionalString silently DROPS a
 *  number, so `{"runId": 5}` would look like "no runId given" and return
 *  a success-shaped WRONG answer (the "create a run first" payload). Coerce
 *  top-level scalars to their string form so an MCP arg behaves exactly like
 *  the CLI's argv, which is always strings. Arrays/objects (e.g.
 *  authorizedRoles) pass through untouched; null/undefined stay absent.
 *  JSON `false` stays a real `false` (core/util/cli-args.ts
 *  coerceMcpScalar): its string form "false" read as ON through every
 *  `Boolean(args.x)` flag read. */
function coerceScalarArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = coerceMcpScalar(value);
  }
  return out;
}

/** `callTool(name, args)` — resolves `cwd` (SPEC/mcp.md invariant 7),
 *  checks required args, then calls the row's `mcp.handler`. Throws
 *  `Unknown tool: <name>` for a name with no row. */
export function callTool(name: string, rawArgs: unknown): unknown {
  const row = findCapabilityByMcpTool(name);
  if (!row || !row.mcp) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const args = coerceScalarArgs(requiredToolArguments(name, rawArgs));

  const resolvedArgs = { ...args };
  const cwdInput = args.cwd;
  if (typeof cwdInput === "string" && cwdInput.length > 0) {
    const resolved = path.resolve(cwdInput);
    // throwIfNoEntry:false so a MISSING cwd yields the same crafted
    // "not a directory" message as a non-dir path — not a raw ENOENT that
    // gives the recovery-hint matcher nothing to key on.
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });
    if (!stat || !stat.isDirectory()) {
      throw new Error(`MCP cwd is not a directory: ${resolved}`);
    }
    resolvedArgs.cwd = resolved;
  }

  return row.mcp.handler(resolvedArgs);
}

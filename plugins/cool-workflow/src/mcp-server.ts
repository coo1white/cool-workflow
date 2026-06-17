#!/usr/bin/env node
import { callTool, requiredToolArguments, toolDefinitions } from "./mcp-surface";
import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

process.stdin.setEncoding("utf8");
let buffer = "";

// A single line-delimited JSON-RPC request is bounded; an un-terminated stream
// (a peer that never sends a newline, or a slow byte dribble) must not grow the
// long-lived server's buffer without limit until it OOMs. Cap the unconsumed
// buffer and fail closed on a frame that exceeds it.
const MAX_LINE_BYTES = 16 * 1024 * 1024;

process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleLine(line);
  }
  if (buffer.length > MAX_LINE_BYTES) {
    // No newline in an over-cap buffer => a malformed or hostile frame. Reject it
    // and drop the partial bytes rather than accumulate toward OOM.
    buffer = "";
    sendError(null, -32700, `Parse error: request line exceeds ${MAX_LINE_BYTES} bytes`);
  }
});

function handleLine(line: string): void {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    sendError(null, -32700, `Parse error: ${messageOf(error)}`);
    return;
  }
  try {
    if (message.method === "initialize") {
      sendResult(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cool-workflow", version: CURRENT_COOL_WORKFLOW_VERSION }
      });
      return;
    }
    if (message.method === "tools/list") {
      sendResult(message.id, { tools: toolDefinitions() });
      return;
    }
    if (message.method === "tools/call") {
      const toolName = requiredToolName(message.params?.name);
      const toolArgs = requiredToolArguments(toolName, message.params?.arguments);
      const result = callTool(toolName, toolArgs);
      sendResult(message.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      });
      return;
    }
    if (message.id !== undefined) sendError(message.id, -32601, `Unknown method: ${message.method}`);
  } catch (error) {
    sendError(message.id, -32000, messageOf(error));
  }
}

function requiredToolName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("MCP tools/call missing required field: name");
  return value;
}

function sendResult(id: JsonRpcRequest["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: JsonRpcRequest["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

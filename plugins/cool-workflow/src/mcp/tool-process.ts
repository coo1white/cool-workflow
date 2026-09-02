// mcp/tool-process.ts — the private execution lane for MCP tools.
//
// The MCP server keeps its stdio protocol work in the parent process. This
// child process runs one tools/call at a time, so a synchronous file-lock wait
// or a long agent call cannot stop the parent from reading and answering ping.

import { ChildProcess, fork } from "node:child_process";
import * as path from "node:path";
import { safeJsonStringify } from "../core/format/safe-json";
import { callTool } from "./dispatch";

interface ToolProcessRequest {
  schemaVersion: 1;
  id: number;
  name: string;
  args: unknown;
}

interface ToolProcessSuccess {
  schemaVersion: 1;
  id: number;
  ok: true;
  text: string;
}

interface ToolProcessFailure {
  schemaVersion: 1;
  id: number;
  ok: false;
  error: string;
}

type ToolProcessResponse = ToolProcessSuccess | ToolProcessFailure;

function isResponse(value: unknown): value is ToolProcessResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.id === "number" && typeof record.ok === "boolean" &&
    (record.ok ? typeof record.text === "string" : typeof record.error === "string");
}

function diagnostic(kind: "stdout" | "stderr", chunk: Buffer | string): void {
  const text = String(chunk);
  if (text) process.stderr.write(`cool-workflow mcp tool process ${kind}: ${text}`);
}

/** One durable, serial child process for tools/call. The public MCP server
 * owns response shapes; this class moves only a tool request and its already
 * rendered JSON text across IPC. A stopped child never causes an automatic
 * retry because a tool may already have written part of its state. */
export class ToolProcessExecutor {
  private readonly workerPath: string;
  private child: ChildProcess | undefined;
  private nextId = 1;
  private pending: { id: number; name: string; resolve: (text: string) => void; reject: (error: Error) => void } | undefined;

  constructor(options: { workerPath?: string } = {}) {
    this.workerPath = options.workerPath ?? path.join(__dirname, "tool-process.js");
  }

  execute(name: string, args: unknown): Promise<string> {
    if (this.pending) throw new Error("MCP tool process received concurrent work");
    const child = this.ensureChild();
    const id = this.nextId++;
    const request: ToolProcessRequest = { schemaVersion: 1, id, name, args };
    return new Promise<string>((resolve, reject) => {
      this.pending = { id, name, resolve, reject };
      try {
        child.send(request, (error) => {
          if (!error || this.pending?.id !== id) return;
          this.pending = undefined;
          reject(error);
        });
      } catch (error: unknown) {
        if (this.pending?.id === id) this.pending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    const child = this.child;
    this.child = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) pending.reject(new Error(`MCP tool process stopped before ${pending.name} ended`));
    if (!child) return;
    if (child.connected) child.disconnect();
    child.kill();
  }

  private ensureChild(): ChildProcess {
    if (this.child && !this.child.killed && this.child.connected) return this.child;
    const child = fork(this.workerPath, [], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "json",
    });
    child.stdout?.on("data", (chunk: Buffer) => diagnostic("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => diagnostic("stderr", chunk));
    child.on("message", (message: unknown) => this.handleMessage(child, message));
    child.on("error", (error) => this.handleStopped(child, error));
    child.on("exit", () => this.handleStopped(child));
    this.child = child;
    return child;
  }

  private handleMessage(child: ChildProcess, message: unknown): void {
    if (child !== this.child || !isResponse(message)) {
      this.handleStopped(child, new Error("MCP tool process sent an invalid response"));
      child.kill();
      return;
    }
    const pending = this.pending;
    if (!pending || pending.id !== message.id) {
      this.handleStopped(child, new Error("MCP tool process sent an unexpected response"));
      child.kill();
      return;
    }
    this.pending = undefined;
    if (message.ok) pending.resolve(message.text);
    else pending.reject(new Error(message.error));
  }

  private handleStopped(child: ChildProcess, error?: Error): void {
    if (child !== this.child) return;
    this.child = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      pending.reject(error ?? new Error(`MCP tool process stopped before ${pending.name} ended`));
    }
  }
}

function isRequest(value: unknown): value is ToolProcessRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.id === "number" && typeof record.name === "string";
}

function send(message: ToolProcessResponse): void {
  if (process.send) process.send(message);
}

/** Child entry point. Kept in this module so the parent and child share one
 * small, checked IPC shape. */
function startToolProcessWorker(): void {
  process.on("disconnect", () => process.exit(0));
  process.on("message", async (message: unknown) => {
    if (!isRequest(message)) return;
    try {
      const result = await callTool(message.name, message.args);
      send({ schemaVersion: 1, id: message.id, ok: true, text: safeJsonStringify(result) });
    } catch (error: unknown) {
      send({ schemaVersion: 1, id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (require.main === module) startToolProcessWorker();

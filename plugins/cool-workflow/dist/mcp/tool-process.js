"use strict";
// mcp/tool-process.ts — the private execution lane for MCP tools.
//
// The MCP server keeps its stdio protocol work in the parent process. This
// child process runs one tools/call at a time, so a synchronous file-lock wait
// or a long agent call cannot stop the parent from reading and answering ping.
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
exports.ToolProcessExecutor = void 0;
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const safe_json_1 = require("../core/format/safe-json");
const dispatch_1 = require("./dispatch");
function isResponse(value) {
    if (!value || typeof value !== "object")
        return false;
    const record = value;
    return record.schemaVersion === 1 && typeof record.id === "number" && typeof record.ok === "boolean" &&
        (record.ok ? typeof record.text === "string" : typeof record.error === "string");
}
function diagnostic(kind, chunk) {
    const text = String(chunk);
    if (text)
        process.stderr.write(`cool-workflow mcp tool process ${kind}: ${text}`);
}
/** One durable, serial child process for tools/call. The public MCP server
 * owns response shapes; this class moves only a tool request and its already
 * rendered JSON text across IPC. A stopped child never causes an automatic
 * retry because a tool may already have written part of its state. */
class ToolProcessExecutor {
    workerPath;
    child;
    nextId = 1;
    pending;
    constructor(options = {}) {
        this.workerPath = options.workerPath ?? path.join(__dirname, "tool-process.js");
    }
    execute(name, args) {
        if (this.pending)
            throw new Error("MCP tool process received concurrent work");
        const child = this.ensureChild();
        const id = this.nextId++;
        const request = { schemaVersion: 1, id, name, args };
        return new Promise((resolve, reject) => {
            this.pending = { id, name, resolve, reject };
            try {
                child.send(request, (error) => {
                    if (!error || this.pending?.id !== id)
                        return;
                    this.pending = undefined;
                    reject(error);
                });
            }
            catch (error) {
                if (this.pending?.id === id)
                    this.pending = undefined;
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    close() {
        const child = this.child;
        this.child = undefined;
        const pending = this.pending;
        this.pending = undefined;
        if (pending)
            pending.reject(new Error(`MCP tool process stopped before ${pending.name} ended`));
        if (!child)
            return;
        if (child.connected)
            child.disconnect();
        child.kill();
    }
    ensureChild() {
        if (this.child && !this.child.killed && this.child.connected)
            return this.child;
        const child = (0, node_child_process_1.fork)(this.workerPath, [], {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            serialization: "json",
        });
        child.stdout?.on("data", (chunk) => diagnostic("stdout", chunk));
        child.stderr?.on("data", (chunk) => diagnostic("stderr", chunk));
        child.on("message", (message) => this.handleMessage(child, message));
        child.on("error", (error) => this.handleStopped(child, error));
        child.on("exit", () => this.handleStopped(child));
        this.child = child;
        return child;
    }
    handleMessage(child, message) {
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
        if (message.ok)
            pending.resolve(message.text);
        else
            pending.reject(new Error(message.error));
    }
    handleStopped(child, error) {
        if (child !== this.child)
            return;
        this.child = undefined;
        const pending = this.pending;
        this.pending = undefined;
        if (pending) {
            pending.reject(error ?? new Error(`MCP tool process stopped before ${pending.name} ended`));
        }
    }
}
exports.ToolProcessExecutor = ToolProcessExecutor;
function isRequest(value) {
    if (!value || typeof value !== "object")
        return false;
    const record = value;
    return record.schemaVersion === 1 && typeof record.id === "number" && typeof record.name === "string";
}
function send(message) {
    if (process.send)
        process.send(message);
}
/** Child entry point. Kept in this module so the parent and child share one
 * small, checked IPC shape. */
function startToolProcessWorker() {
    process.on("disconnect", () => process.exit(0));
    process.on("message", async (message) => {
        if (!isRequest(message))
            return;
        try {
            const result = await (0, dispatch_1.callTool)(message.name, message.args);
            send({ schemaVersion: 1, id: message.id, ok: true, text: (0, safe_json_1.safeJsonStringify)(result) });
        }
        catch (error) {
            send({ schemaVersion: 1, id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
}
if (require.main === module)
    startToolProcessWorker();

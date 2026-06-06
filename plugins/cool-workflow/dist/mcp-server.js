#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const orchestrator_1 = require("./orchestrator");
const scheduler_1 = require("./scheduler");
const triggers_1 = require("./triggers");
const runner = new orchestrator_1.CoolWorkflowRunner({
    pluginRoot: node_path_1.default.resolve(__dirname, "..")
});
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line)
            handleLine(line);
    }
});
function handleLine(line) {
    let message;
    try {
        message = JSON.parse(line);
    }
    catch (error) {
        sendError(null, -32700, `Parse error: ${messageOf(error)}`);
        return;
    }
    try {
        if (message.method === "initialize") {
            sendResult(message.id, {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "cool-workflow", version: "0.1.1" }
            });
            return;
        }
        if (message.method === "tools/list") {
            sendResult(message.id, { tools: toolDefinitions() });
            return;
        }
        if (message.method === "tools/call") {
            const result = callTool(message.params?.name || "", message.params?.arguments || {});
            sendResult(message.id, {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
            });
            return;
        }
        if (message.id !== undefined)
            sendError(message.id, -32601, `Unknown method: ${message.method}`);
    }
    catch (error) {
        sendError(message.id, -32000, messageOf(error));
    }
}
function callTool(name, args) {
    const previousCwd = process.cwd();
    if (args.cwd)
        process.chdir(String(args.cwd));
    const scheduler = new scheduler_1.Scheduler(process.cwd());
    const triggers = new triggers_1.RoutineTriggerBridge(process.cwd());
    try {
        switch (name) {
            case "cw_list":
                return runner.listWorkflows();
            case "cw_plan":
                return runner.plan(String(args.workflowId || ""), args);
            case "cw_status":
                return runner.status(String(args.runId || ""));
            case "cw_dispatch":
                return runner.dispatch(String(args.runId || ""), args);
            case "cw_result":
                return runner.recordResult(String(args.runId || ""), String(args.taskId || ""), String(args.resultPath || ""));
            case "cw_commit":
                return runner.commit(String(args.runId || ""), String(args.reason || "manual"));
            case "cw_report":
                return runner.report(String(args.runId || ""));
            case "cw_schedule_create":
                return scheduler.create(args);
            case "cw_schedule_list":
                return scheduler.list(args.status ? String(args.status) : undefined);
            case "cw_schedule_delete":
                return scheduler.delete(String(args.id || ""));
            case "cw_schedule_due":
                return scheduler.due();
            case "cw_schedule_complete":
                return scheduler.complete(String(args.id || ""), args);
            case "cw_schedule_pause":
                return scheduler.pause(String(args.id || ""));
            case "cw_schedule_resume":
                return scheduler.resume(String(args.id || ""));
            case "cw_schedule_run_now":
                return scheduler.runNow(String(args.id || ""));
            case "cw_schedule_history":
                return scheduler.history(args.id ? String(args.id) : undefined);
            case "cw_routine_create":
                return triggers.create(args);
            case "cw_routine_list":
                return triggers.list(args.kind ? String(args.kind) : undefined);
            case "cw_routine_delete":
                return triggers.delete(String(args.id || ""));
            case "cw_routine_fire":
                return triggers.fire(String(args.kind || "api"), args.payload || args);
            case "cw_routine_events":
                return triggers.events(args.id ? String(args.id) : undefined);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    finally {
        process.chdir(previousCwd);
    }
}
function toolDefinitions() {
    return [
        tool("cw_list", "List bundled CW workflows.", {}),
        tool("cw_plan", "Create a CW run.", {
            workflowId: stringSchema("Workflow id"),
            repo: stringSchema("Repository path"),
            question: stringSchema("User question")
        }),
        tool("cw_status", "Read run checkpoint status.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace")
        }),
        tool("cw_dispatch", "Create a subagent dispatch manifest.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace"),
            limit: numberSchema("Max tasks to dispatch")
        }),
        tool("cw_result", "Record a subagent result.", {
            runId: stringSchema("Run id"),
            taskId: stringSchema("Task id"),
            resultPath: stringSchema("Result markdown path"),
            cwd: stringSchema("Run workspace")
        }),
        tool("cw_commit", "Create a state commit snapshot.", {
            runId: stringSchema("Run id"),
            reason: stringSchema("Commit reason"),
            cwd: stringSchema("Run workspace")
        }),
        tool("cw_report", "Render a run report.", {
            runId: stringSchema("Run id"),
            cwd: stringSchema("Run workspace")
        }),
        tool("cw_schedule_create", "Create a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("loop, cron, or reminder"),
            prompt: stringSchema("Prompt to run"),
            intervalMinutes: numberSchema("Loop interval in minutes"),
            cron: stringSchema("5-field cron expression"),
            delayMinutes: numberSchema("Reminder delay in minutes")
        }),
        tool("cw_schedule_list", "List scheduled CW tasks.", {
            cwd: stringSchema("Workspace"),
            status: stringSchema("Optional status filter")
        }),
        tool("cw_schedule_due", "List due scheduled CW tasks.", {
            cwd: stringSchema("Workspace")
        }),
        tool("cw_schedule_complete", "Mark a scheduled CW task run complete and advance it.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        tool("cw_schedule_pause", "Pause a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        tool("cw_schedule_resume", "Resume a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        tool("cw_schedule_run_now", "Create an immediate scheduled-task run record.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        tool("cw_schedule_history", "List scheduled-task run history.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Optional schedule id")
        }),
        tool("cw_schedule_delete", "Delete a scheduled CW task.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Schedule id")
        }),
        tool("cw_routine_create", "Create a routine-style API or GitHub trigger.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("api or github"),
            prompt: stringSchema("Prompt to run when the trigger matches"),
            match: stringSchema("Optional JSON object match rule")
        }),
        tool("cw_routine_list", "List routine-style triggers.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("Optional api or github filter")
        }),
        tool("cw_routine_fire", "Record an API or GitHub trigger event.", {
            cwd: stringSchema("Workspace"),
            kind: stringSchema("api or github"),
            payload: { type: "object", description: "Event payload" }
        }),
        tool("cw_routine_events", "List routine trigger events.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Optional trigger id")
        }),
        tool("cw_routine_delete", "Delete a routine-style trigger.", {
            cwd: stringSchema("Workspace"),
            id: stringSchema("Trigger id")
        })
    ];
}
function tool(name, description, properties) {
    return {
        name,
        description,
        inputSchema: {
            type: "object",
            properties,
            additionalProperties: true
        }
    };
}
function stringSchema(description) {
    return { type: "string", description };
}
function numberSchema(description) {
    return { type: "number", description };
}
function sendResult(id, result) {
    send({ jsonrpc: "2.0", id, result });
}
function sendError(id, code, message) {
    send({ jsonrpc: "2.0", id, error: { code, message } });
}
function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}

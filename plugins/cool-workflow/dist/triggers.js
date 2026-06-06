"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutineTriggerBridge = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
class RoutineTriggerBridge {
    cwd;
    storePath;
    payloadsDir;
    constructor(cwd = process.cwd()) {
        this.cwd = node_path_1.default.resolve(cwd);
        this.storePath = node_path_1.default.join(this.cwd, ".cw", "routines", "triggers.json");
        this.payloadsDir = node_path_1.default.join(this.cwd, ".cw", "routines", "payloads");
    }
    create(options) {
        const now = new Date().toISOString();
        const trigger = {
            id: createTriggerId(normalizeKind(options.kind)),
            kind: normalizeKind(options.kind),
            createdAt: now,
            updatedAt: now,
            source: String(options.source || options.kind || "api"),
            prompt: requiredString(options.prompt, "prompt"),
            workflowId: stringOption(options.workflowId),
            runId: stringOption(options.runId),
            match: parseJsonObject(options.match),
            metadata: parseJsonObject(options.metadata)
        };
        const store = this.load();
        store.triggers.push(trigger);
        this.save(store);
        return trigger;
    }
    list(kind) {
        const store = this.load();
        return kind ? store.triggers.filter((trigger) => trigger.kind === kind) : store.triggers;
    }
    delete(id) {
        const store = this.load();
        const before = store.triggers.length;
        store.triggers = store.triggers.filter((trigger) => trigger.id !== id);
        this.save(store);
        return { deleted: store.triggers.length !== before, id };
    }
    fire(kind, payload) {
        const normalizedKind = normalizeKind(kind);
        const store = this.load();
        const now = new Date().toISOString();
        const events = store.triggers
            .filter((trigger) => trigger.kind === normalizedKind)
            .map((trigger) => this.createEvent(trigger, payload, now));
        store.events.push(...events);
        this.save(store);
        return events;
    }
    events(triggerId) {
        const store = this.load();
        return triggerId ? store.events.filter((event) => event.triggerId === triggerId) : store.events;
    }
    createEvent(trigger, payload, receivedAt) {
        const matched = matches(trigger.match, payload);
        const eventId = createEventId(trigger.kind);
        const payloadPath = node_path_1.default.join(this.payloadsDir, `${(0, state_1.safeFileName)(eventId)}.json`);
        (0, state_1.writeJson)(payloadPath, {
            schemaVersion: 1,
            trigger,
            receivedAt,
            matched,
            payload
        });
        return {
            id: eventId,
            triggerId: trigger.id,
            kind: trigger.kind,
            receivedAt,
            matched,
            prompt: matched ? renderPrompt(trigger, payload) : undefined,
            payloadPath
        };
    }
    load() {
        if (!node_fs_1.default.existsSync(this.storePath))
            return { schemaVersion: 1, triggers: [], events: [] };
        const value = (0, state_1.readJson)(this.storePath);
        return {
            schemaVersion: 1,
            triggers: Array.isArray(value.triggers) ? value.triggers : [],
            events: Array.isArray(value.events) ? value.events : []
        };
    }
    save(store) {
        (0, state_1.writeJson)(this.storePath, store);
    }
}
exports.RoutineTriggerBridge = RoutineTriggerBridge;
function normalizeKind(value) {
    const kind = String(value || "api");
    if (kind === "api" || kind === "github")
        return kind;
    throw new Error(`Unsupported routine trigger kind: ${kind}`);
}
function matches(match, payload) {
    if (!match || !Object.keys(match).length)
        return true;
    if (!payload || typeof payload !== "object")
        return false;
    return Object.entries(match).every(([key, expected]) => deepValue(payload, key) === expected);
}
function deepValue(value, key) {
    return key.split(".").reduce((current, part) => {
        if (!current || typeof current !== "object")
            return undefined;
        return current[part];
    }, value);
}
function renderPrompt(trigger, payload) {
    return `${trigger.prompt}\n\ncw:routine\n${JSON.stringify({
        triggerId: trigger.id,
        kind: trigger.kind,
        source: trigger.source,
        workflowId: trigger.workflowId,
        runId: trigger.runId,
        payload
    }, null, 2)}`;
}
function parseJsonObject(value) {
    if (!value || value === true)
        return undefined;
    if (typeof value === "object")
        return value;
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected JSON object");
    }
    return parsed;
}
function requiredString(value, name) {
    const text = stringOption(value);
    if (!text)
        throw new Error(`Missing required ${name}`);
    return text;
}
function stringOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    return String(value);
}
function createTriggerId(kind) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
function createEventId(kind) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `event-${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

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
        const store = this.load();
        // Monotonic id, NOT triggers.length: delete shrinks the collection, so a
        // length-based seq would reuse a live id after delete+create (corrupting the
        // append-only event/audit log). nextTriggerSeq only ever increments.
        const seq = (store.nextTriggerSeq || 0) + 1;
        store.nextTriggerSeq = seq;
        const trigger = {
            id: createTriggerId(normalizeKind(options.kind), seq),
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
        const base = store.events.length;
        const events = store.triggers
            .filter((trigger) => trigger.kind === normalizedKind)
            .map((trigger, index) => this.createEvent(trigger, payload, now, base + index + 1));
        store.events.push(...events);
        this.save(store);
        return events;
    }
    events(triggerId) {
        const store = this.load();
        return triggerId ? store.events.filter((event) => event.triggerId === triggerId) : store.events;
    }
    createEvent(trigger, payload, receivedAt, seq) {
        const matched = matches(trigger.match, payload);
        const eventId = createEventId(trigger.kind, seq);
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
            return { schemaVersion: 1, triggers: [], events: [], nextTriggerSeq: 0 };
        const value = (0, state_1.readJson)(this.storePath);
        const triggers = Array.isArray(value.triggers) ? value.triggers : [];
        // Recover the monotonic sequence: max(persisted, highest existing id seq). The
        // second term protects legacy stores (no nextTriggerSeq) and any store written
        // before this field existed — a post-delete create can never reuse a live id.
        const maxExisting = triggers.reduce((max, trigger) => {
            const n = Number((String(trigger.id).match(/(\d+)$/) || [])[1] || 0);
            return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        return {
            schemaVersion: 1,
            triggers,
            events: Array.isArray(value.events) ? value.events : [],
            nextTriggerSeq: Math.max(typeof value.nextTriggerSeq === "number" ? value.nextTriggerSeq : 0, maxExisting)
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
// Deterministic trigger id (FreeBSD-audit L12/L13): the trigger's POSITION in the
// append-only trigger store, qualified by kind. No wall-clock stamp, no PRNG suffix
// — registering the same triggers in the same order mints byte-identical ids.
function createTriggerId(kind, seq) {
    return `${kind}-${String(seq).padStart(4, "0")}`;
}
// Deterministic event id (FreeBSD-audit L12/L13): the event's POSITION in the
// append-only event log (firing many triggers at once still yields a distinct,
// stable id per trigger). No clock, no PRNG.
function createEventId(kind, seq) {
    return `event-${kind}-${String(seq).padStart(4, "0")}`;
}

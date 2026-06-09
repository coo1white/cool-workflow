"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const DEFAULT_TTL_DAYS = 7;
class Scheduler {
    cwd;
    storePath;
    constructor(cwd = process.cwd()) {
        this.cwd = node_path_1.default.resolve(cwd);
        this.storePath = node_path_1.default.join(this.cwd, ".cw", "schedules", "tasks.json");
    }
    create(options) {
        const kind = normalizeKind(options.kind);
        const now = new Date();
        const intervalMinutes = numberOption(options.intervalMinutes || options.interval);
        const cron = stringOption(options.cron);
        const delayMinutes = numberOption(options.delayMinutes || options.delay);
        const jitterSeconds = numberOption(options.jitterSeconds) ?? 0;
        const nextRunAt = computeInitialNextRunAt({ kind, now, intervalMinutes, cron, delayMinutes, jitterSeconds });
        const ttlDays = numberOption(options.ttlDays) ?? DEFAULT_TTL_DAYS;
        const task = {
            id: createScheduleId(kind),
            kind,
            status: "active",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            nextRunAt: nextRunAt.toISOString(),
            expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
            prompt: requiredString(options.prompt, "prompt"),
            workflowId: stringOption(options.workflowId),
            runId: stringOption(options.runId),
            sessionId: stringOption(options.sessionId),
            intervalMinutes,
            cron,
            jitterSeconds,
            maxRuns: numberOption(options.maxRuns),
            runCount: 0
        };
        const store = this.load();
        store.tasks.push(task);
        this.save(store);
        return task;
    }
    list(status) {
        const store = this.load();
        return status ? store.tasks.filter((task) => task.status === status) : store.tasks;
    }
    delete(id) {
        const store = this.load();
        const before = store.tasks.length;
        store.tasks = store.tasks.filter((task) => task.id !== id);
        this.save(store);
        return { deleted: store.tasks.length !== before, id };
    }
    due(now = new Date()) {
        const store = this.load();
        let changed = false;
        for (const task of store.tasks) {
            if (task.status === "active" && new Date(task.expiresAt).getTime() <= now.getTime()) {
                task.status = "expired";
                task.updatedAt = now.toISOString();
                changed = true;
            }
        }
        if (changed)
            this.save(store);
        const dueTasks = store.tasks.filter((task) => task.status === "active" && new Date(task.nextRunAt).getTime() <= now.getTime());
        if (dueTasks.length) {
            for (const task of dueTasks) {
                const alreadyRecorded = task.lastDueAt && new Date(task.lastDueAt).getTime() >= new Date(task.nextRunAt).getTime();
                if (alreadyRecorded)
                    continue;
                task.lastDueAt = now.toISOString();
                store.history.push(createHistoryRecord(task, "due", this.cwd, now));
                changed = true;
            }
        }
        if (changed)
            this.save(store);
        return dueTasks;
    }
    complete(id, options = {}) {
        const store = this.load();
        const task = store.tasks.find((candidate) => candidate.id === id);
        if (!task)
            throw new Error(`Scheduled task not found: ${id}`);
        const now = new Date();
        task.runCount += 1;
        task.lastRunAt = now.toISOString();
        task.updatedAt = now.toISOString();
        const maxRuns = numberOption(options.maxRuns) ?? task.maxRuns;
        if (maxRuns !== undefined)
            task.maxRuns = maxRuns;
        if (task.kind === "reminder" || (task.maxRuns !== undefined && task.runCount >= task.maxRuns)) {
            task.status = "completed";
        }
        else {
            task.nextRunAt = computeNextRunAt(task, now).toISOString();
        }
        this.save(store);
        return task;
    }
    pause(id) {
        return this.setStatus(id, "paused");
    }
    resume(id) {
        const store = this.load();
        const task = findTask(store, id);
        const now = new Date();
        task.status = "active";
        task.updatedAt = now.toISOString();
        if (new Date(task.nextRunAt).getTime() <= now.getTime()) {
            task.nextRunAt = computeNextRunAt(task, now).toISOString();
        }
        this.save(store);
        return task;
    }
    runNow(id) {
        const store = this.load();
        const task = findTask(store, id);
        const now = new Date();
        task.lastDueAt = now.toISOString();
        task.updatedAt = now.toISOString();
        const record = createHistoryRecord(task, "started", this.cwd, now);
        store.history.push(record);
        this.save(store);
        return record;
    }
    history(id) {
        const store = this.load();
        return id ? store.history.filter((record) => record.scheduleId === id) : store.history;
    }
    setStatus(id, status) {
        const store = this.load();
        const task = findTask(store, id);
        task.status = status;
        task.updatedAt = new Date().toISOString();
        this.save(store);
        return task;
    }
    load() {
        if (!node_fs_1.default.existsSync(this.storePath))
            return { schemaVersion: 1, tasks: [], history: [] };
        const value = (0, state_1.readJson)(this.storePath);
        return {
            schemaVersion: 1,
            tasks: Array.isArray(value.tasks) ? value.tasks : [],
            history: Array.isArray(value.history) ? value.history : []
        };
    }
    save(store) {
        // Authoritative scheduler store — atomic + durable (v0.1.40). writeJson is now
        // always atomic (temp → rename), so a crash mid-write can never truncate it.
        (0, state_1.writeJson)(this.storePath, store, { durable: true });
    }
}
exports.Scheduler = Scheduler;
function findTask(store, id) {
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task)
        throw new Error(`Scheduled task not found: ${id}`);
    return task;
}
function createHistoryRecord(task, status, cwd, now) {
    return {
        id: createScheduleRunId(task.kind),
        scheduleId: task.id,
        status,
        dueAt: now.toISOString(),
        startedAt: status === "started" ? now.toISOString() : undefined,
        prompt: task.prompt,
        cwd,
        workflowId: task.workflowId,
        runId: task.runId
    };
}
function normalizeKind(value) {
    const kind = String(value || "loop");
    if (["loop", "cron", "reminder"].includes(kind))
        return kind;
    throw new Error(`Unsupported schedule kind: ${kind}`);
}
function computeInitialNextRunAt(options) {
    if (options.kind === "reminder") {
        return addJitter(new Date(options.now.getTime() + (options.delayMinutes ?? options.intervalMinutes ?? 1) * 60 * 1000), options.jitterSeconds);
    }
    if (options.kind === "cron") {
        if (!options.cron)
            throw new Error("cron schedule requires --cron");
        return addJitter(nextFromCron(options.cron, options.now), options.jitterSeconds);
    }
    return addJitter(new Date(options.now.getTime() + (options.intervalMinutes ?? 1) * 60 * 1000), options.jitterSeconds);
}
function computeNextRunAt(task, now) {
    if (task.kind === "cron" && task.cron)
        return addJitter(nextFromCron(task.cron, now), task.jitterSeconds);
    return addJitter(new Date(now.getTime() + (task.intervalMinutes ?? 1) * 60 * 1000), task.jitterSeconds);
}
function nextFromCron(cron, now) {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5)
        throw new Error("Only 5-field cron expressions are supported");
    const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;
    const cursor = new Date(now.getTime() + 60 * 1000);
    cursor.setSeconds(0, 0);
    for (let attempt = 0; attempt < 8 * 24 * 60; attempt += 1) {
        if (matchesCron(cursor.getMinutes(), minuteExpr, 0, 59) &&
            matchesCron(cursor.getHours(), hourExpr, 0, 23) &&
            matchesCron(cursor.getDate(), dayExpr, 1, 31) &&
            matchesCron(cursor.getMonth() + 1, monthExpr, 1, 12) &&
            matchesCron(cursor.getDay(), weekdayExpr, 0, 6)) {
            return cursor;
        }
        cursor.setMinutes(cursor.getMinutes() + 1);
    }
    throw new Error("Unable to resolve next cron run within 8 days");
}
function matchesCron(value, expr, min, max) {
    if (expr === "*")
        return true;
    if (expr.startsWith("*/")) {
        const step = Number(expr.slice(2));
        return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    return expr.split(",").some((part) => {
        const parsed = Number(part);
        return Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed === value;
    });
}
function addJitter(date, jitterSeconds) {
    if (!jitterSeconds)
        return date;
    const offset = Math.floor(Math.random() * (jitterSeconds + 1)) * 1000;
    return new Date(date.getTime() + offset);
}
function createScheduleId(kind) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
function createScheduleRunId(kind) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `run-${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
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
function numberOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

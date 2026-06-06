import fs from "node:fs";
import path from "node:path";
import { ScheduleKind, ScheduleRunRecord, ScheduleStatus, ScheduleStore, ScheduledTask } from "./types";
import { readJson, writeJson } from "./state";

const DEFAULT_TTL_DAYS = 7;

export class Scheduler {
  cwd: string;
  storePath: string;

  constructor(cwd = process.cwd()) {
    this.cwd = path.resolve(cwd);
    this.storePath = path.join(this.cwd, ".cw", "schedules", "tasks.json");
  }

  create(options: Record<string, unknown>): ScheduledTask {
    const kind = normalizeKind(options.kind);
    const now = new Date();
    const intervalMinutes = numberOption(options.intervalMinutes || options.interval);
    const cron = stringOption(options.cron);
    const delayMinutes = numberOption(options.delayMinutes || options.delay);
    const jitterSeconds = numberOption(options.jitterSeconds) ?? 0;
    const nextRunAt = computeInitialNextRunAt({ kind, now, intervalMinutes, cron, delayMinutes, jitterSeconds });
    const ttlDays = numberOption(options.ttlDays) ?? DEFAULT_TTL_DAYS;
    const task: ScheduledTask = {
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

  list(status?: string): ScheduledTask[] {
    const store = this.load();
    return status ? store.tasks.filter((task) => task.status === status) : store.tasks;
  }

  delete(id: string): { deleted: boolean; id: string } {
    const store = this.load();
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((task) => task.id !== id);
    this.save(store);
    return { deleted: store.tasks.length !== before, id };
  }

  due(now = new Date()): ScheduledTask[] {
    const store = this.load();
    let changed = false;
    for (const task of store.tasks) {
      if (task.status === "active" && new Date(task.expiresAt).getTime() <= now.getTime()) {
        task.status = "expired";
        task.updatedAt = now.toISOString();
        changed = true;
      }
    }
    if (changed) this.save(store);
    const dueTasks = store.tasks.filter(
      (task) => task.status === "active" && new Date(task.nextRunAt).getTime() <= now.getTime()
    );
    if (dueTasks.length) {
      for (const task of dueTasks) {
        const alreadyRecorded = task.lastDueAt && new Date(task.lastDueAt).getTime() >= new Date(task.nextRunAt).getTime();
        if (alreadyRecorded) continue;
        task.lastDueAt = now.toISOString();
        store.history.push(createHistoryRecord(task, "due", this.cwd, now));
        changed = true;
      }
    }
    if (changed) this.save(store);
    return dueTasks;
  }

  complete(id: string, options: Record<string, unknown> = {}): ScheduledTask {
    const store = this.load();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error(`Scheduled task not found: ${id}`);
    const now = new Date();
    task.runCount += 1;
    task.lastRunAt = now.toISOString();
    task.updatedAt = now.toISOString();
    const maxRuns = numberOption(options.maxRuns) ?? task.maxRuns;
    if (maxRuns !== undefined) task.maxRuns = maxRuns;
    if (task.kind === "reminder" || (task.maxRuns !== undefined && task.runCount >= task.maxRuns)) {
      task.status = "completed";
    } else {
      task.nextRunAt = computeNextRunAt(task, now).toISOString();
    }
    this.save(store);
    return task;
  }

  pause(id: string): ScheduledTask {
    return this.setStatus(id, "paused");
  }

  resume(id: string): ScheduledTask {
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

  runNow(id: string): ScheduleRunRecord {
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

  history(id?: string): ScheduleRunRecord[] {
    const store = this.load();
    return id ? store.history.filter((record) => record.scheduleId === id) : store.history;
  }

  private setStatus(id: string, status: ScheduleStatus): ScheduledTask {
    const store = this.load();
    const task = findTask(store, id);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    this.save(store);
    return task;
  }

  private load(): ScheduleStore {
    if (!fs.existsSync(this.storePath)) return { schemaVersion: 1, tasks: [], history: [] };
    const value = readJson(this.storePath) as ScheduleStore;
    return {
      schemaVersion: 1,
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      history: Array.isArray(value.history) ? value.history : []
    };
  }

  private save(store: ScheduleStore): void {
    writeJson(this.storePath, store);
  }
}

function findTask(store: ScheduleStore, id: string): ScheduledTask {
  const task = store.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Scheduled task not found: ${id}`);
  return task;
}

function createHistoryRecord(
  task: ScheduledTask,
  status: ScheduleRunRecord["status"],
  cwd: string,
  now: Date
): ScheduleRunRecord {
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

function normalizeKind(value: unknown): ScheduleKind {
  const kind = String(value || "loop");
  if (["loop", "cron", "reminder"].includes(kind)) return kind as ScheduleKind;
  throw new Error(`Unsupported schedule kind: ${kind}`);
}

function computeInitialNextRunAt(options: {
  kind: ScheduleKind;
  now: Date;
  intervalMinutes?: number;
  cron?: string;
  delayMinutes?: number;
  jitterSeconds: number;
}): Date {
  if (options.kind === "reminder") {
    return addJitter(new Date(options.now.getTime() + (options.delayMinutes ?? options.intervalMinutes ?? 1) * 60 * 1000), options.jitterSeconds);
  }
  if (options.kind === "cron") {
    if (!options.cron) throw new Error("cron schedule requires --cron");
    return addJitter(nextFromCron(options.cron, options.now), options.jitterSeconds);
  }
  return addJitter(new Date(options.now.getTime() + (options.intervalMinutes ?? 1) * 60 * 1000), options.jitterSeconds);
}

function computeNextRunAt(task: ScheduledTask, now: Date): Date {
  if (task.kind === "cron" && task.cron) return addJitter(nextFromCron(task.cron, now), task.jitterSeconds);
  return addJitter(new Date(now.getTime() + (task.intervalMinutes ?? 1) * 60 * 1000), task.jitterSeconds);
}

function nextFromCron(cron: string, now: Date): Date {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Only 5-field cron expressions are supported");
  const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;
  const cursor = new Date(now.getTime() + 60 * 1000);
  cursor.setSeconds(0, 0);
  for (let attempt = 0; attempt < 8 * 24 * 60; attempt += 1) {
    if (
      matchesCron(cursor.getMinutes(), minuteExpr, 0, 59) &&
      matchesCron(cursor.getHours(), hourExpr, 0, 23) &&
      matchesCron(cursor.getDate(), dayExpr, 1, 31) &&
      matchesCron(cursor.getMonth() + 1, monthExpr, 1, 12) &&
      matchesCron(cursor.getDay(), weekdayExpr, 0, 6)
    ) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new Error("Unable to resolve next cron run within 8 days");
}

function matchesCron(value: number, expr: string, min: number, max: number): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = Number(expr.slice(2));
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }
  return expr.split(",").some((part) => {
    const parsed = Number(part);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed === value;
  });
}

function addJitter(date: Date, jitterSeconds: number): Date {
  if (!jitterSeconds) return date;
  const offset = Math.floor(Math.random() * (jitterSeconds + 1)) * 1000;
  return new Date(date.getTime() + offset);
}

function createScheduleId(kind: ScheduleKind): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function createScheduleRunId(kind: ScheduleKind): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `run-${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function requiredString(value: unknown, name: string): string {
  const text = stringOption(value);
  if (!text) throw new Error(`Missing required ${name}`);
  return text;
}

function stringOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

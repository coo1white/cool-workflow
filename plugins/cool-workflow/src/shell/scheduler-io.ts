// shell/scheduler-io.ts — Scheduler (cw schedule/loop), the daemon tick
// (cw schedule daemon), and routine triggers (cw routine).
//
// MILESTONE 10 (project/docs/rebuild/PLAN.md build order, step 10). Byte-exact port of the
// old build's scheduler module + daemon module + triggers module. Reuses
// shell/fs-atomic.ts's `withFileLock`/`readJson`/`writeJson`/`safeFileName`
// directly (no reimplementation).
//
// Two separate systems, never merged (SPEC/scheduling-registry.md
// "Rebuild risks" #4): `Scheduler`/`DesktopSchedulerDaemon`/
// `RoutineTriggerBridge` here are WALL-CLOCK tasks under
// `<cwd>/.cw/schedules/` and `<cwd>/.cw/routines/`; `cw sched` (leases
// over `$CW_HOME/registry/queue.json`) is a completely different system
// — see shell/scheduling-io.ts. `cw loop` is only sugar for
// `schedule create --kind loop`.
//
// Evidence: SPEC/scheduling-registry.md sections A, B;
// the old build's scheduler module, daemon module, triggers module
// (byte-exact source).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, safeFileName, withFileLock, writeJson } from "./fs-atomic";

// ---------------------------------------------------------------------------
// Types (byte-exact port of schedule types module)
// ---------------------------------------------------------------------------

export type ScheduleKind = "loop" | "cron" | "reminder";
export type ScheduleStatus = "active" | "paused" | "completed" | "expired";

export interface ScheduledTask {
  id: string;
  kind: ScheduleKind;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  expiresAt: string;
  prompt: string;
  workflowId?: string;
  runId?: string;
  sessionId?: string;
  intervalMinutes?: number;
  cron?: string;
  jitterSeconds: number;
  maxRuns?: number;
  runCount: number;
  lastRunAt?: string;
  lastDueAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export type ScheduleRunStatus = "due" | "started" | "completed" | "failed" | "skipped";

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  status: ScheduleRunStatus;
  dueAt: string;
  startedAt?: string;
  completedAt?: string;
  prompt: string;
  cwd: string;
  workflowId?: string;
  runId?: string;
  error?: string;
}

export interface ScheduleStore {
  schemaVersion: 1;
  tasks: ScheduledTask[];
  history: ScheduleRunRecord[];
}

const DEFAULT_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Scheduler — cw schedule / cw loop
// ---------------------------------------------------------------------------

export class Scheduler {
  cwd: string;
  storePath: string;

  constructor(cwd = process.cwd()) {
    this.cwd = path.resolve(cwd);
    this.storePath = path.join(this.cwd, ".cw", "schedules", "tasks.json");
  }

  private locked<T>(fn: () => T): T {
    return withFileLock(this.storePath, fn);
  }

  create(options: Record<string, unknown>): ScheduledTask {
    const kind = normalizeKind(options.kind);
    const now = new Date();
    // Fail closed on a bad number rather than silently clamping a typo into a
    // runaway: interval is a whole number of 0 or more (0 = due now, a real
    // supported value), maxRuns a whole number more than 0, jitter/delay 0 or
    // more, ttlDays more than 0. Use `??` (not `||`) when picking the option so
    // an explicit 0 is kept -- for interval a valid "due now", not swallowed
    // into the default 1; for the others kept and then rejected.
    const intervalMinutes = requireNonNegativeInt(options.intervalMinutes ?? options.interval, "interval");
    const cron = stringOption(options.cron);
    const delayMinutes = requireNonNegative(options.delayMinutes ?? options.delay, "delay");
    const jitterSeconds = requireNonNegative(options.jitterSeconds, "jitterSeconds") ?? 0;
    const nextRunAt = computeInitialNextRunAt({ kind, now, intervalMinutes, cron, delayMinutes, jitterSeconds });
    const ttlDays = requirePositive(options.ttlDays, "ttlDays") ?? DEFAULT_TTL_DAYS;
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
      maxRuns: requirePositiveInt(options.maxRuns, "maxRuns"),
      runCount: 0,
    };
    return this.locked(() => {
      const store = this.load();
      store.tasks.push(task);
      this.save(store);
      return task;
    });
  }

  list(status?: string): ScheduledTask[] {
    const store = this.load();
    return status ? store.tasks.filter((task) => task.status === status) : store.tasks;
  }

  delete(id: string): { deleted: boolean; id: string } {
    return this.locked(() => {
      const store = this.load();
      const before = store.tasks.length;
      store.tasks = store.tasks.filter((task) => task.id !== id);
      this.save(store);
      return { deleted: store.tasks.length !== before, id };
    });
  }

  due(now = new Date()): ScheduledTask[] {
    return this.locked(() => this.dueLocked(now));
  }

  private dueLocked(now: Date): ScheduledTask[] {
    const store = this.load();
    let changed = false;
    for (const task of store.tasks) {
      if (task.status === "active" && reachedBy(task.expiresAt, now)) {
        task.status = "expired";
        task.updatedAt = now.toISOString();
        changed = true;
      }
    }
    if (changed) this.save(store);
    const dueTasks = store.tasks.filter((task) => task.status === "active" && reachedBy(task.nextRunAt, now));
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
    return this.locked(() => {
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
    });
  }

  pause(id: string): ScheduledTask {
    return this.setStatus(id, "paused");
  }

  resume(id: string): ScheduledTask {
    return this.locked(() => {
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
    });
  }

  runNow(id: string): ScheduleRunRecord {
    return this.locked(() => {
      const store = this.load();
      const task = findTask(store, id);
      const now = new Date();
      task.lastDueAt = now.toISOString();
      task.updatedAt = now.toISOString();
      const record = createHistoryRecord(task, "started", this.cwd, now);
      store.history.push(record);
      this.save(store);
      return record;
    });
  }

  history(id?: string): ScheduleRunRecord[] {
    const store = this.load();
    return id ? store.history.filter((record) => record.scheduleId === id) : store.history;
  }

  private setStatus(id: string, status: ScheduleStatus): ScheduledTask {
    return this.locked(() => {
      const store = this.load();
      const task = findTask(store, id);
      task.status = status;
      task.updatedAt = new Date().toISOString();
      this.save(store);
      return task;
    });
  }

  private load(): ScheduleStore {
    if (!fs.existsSync(this.storePath)) return { schemaVersion: 1, tasks: [], history: [] };
    const value = readJson(this.storePath) as ScheduleStore;
    ensureKnownSchemaVersion(value, "schedule");
    return {
      schemaVersion: 1,
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      history: Array.isArray(value.history) ? value.history : [],
    };
  }

  private save(store: ScheduleStore): void {
    writeJson(this.storePath, store, { durable: true });
  }
}

function findTask(store: ScheduleStore, id: string): ScheduledTask {
  const task = store.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Scheduled task not found: ${id}`);
  return task;
}

function createHistoryRecord(task: ScheduledTask, status: ScheduleRunRecord["status"], cwd: string, now: Date): ScheduleRunRecord {
  return {
    id: createScheduleRunId(task.kind),
    scheduleId: task.id,
    status,
    dueAt: now.toISOString(),
    startedAt: status === "started" ? now.toISOString() : undefined,
    prompt: task.prompt,
    cwd,
    workflowId: task.workflowId,
    runId: task.runId,
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

/** Deterministic jitter: `sha256(baseMs) mod (jitterSeconds+1)` seconds —
 *  a pure function of the base time, no randomness, so it stays replay-
 *  determinstic even though it lands in persisted state. */
function addJitter(date: Date, jitterSeconds: number): Date {
  if (!jitterSeconds) return date;
  const digest = crypto.createHash("sha256").update(`${date.getTime()}`).digest();
  const seconds = digest.readUInt32BE(0) % (jitterSeconds + 1);
  return new Date(date.getTime() + seconds * 1000);
}

let scheduleIdSequence = 0;
function createScheduleId(kind: ScheduleKind): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  scheduleIdSequence += 1;
  const deterministic = /^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || "");
  const suffix = crypto
    .createHash("sha256")
    .update(deterministic ? `${kind}:${process.pid}:${scheduleIdSequence}` : `${kind}:${stamp}:${process.pid}:${scheduleIdSequence}`)
    .digest("hex")
    .slice(0, 6);
  return deterministic ? `${kind}-${suffix}` : `${kind}-${stamp}-${suffix}`;
}

let scheduleRunIdSequence = 0;
function createScheduleRunId(kind: ScheduleKind): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  scheduleRunIdSequence += 1;
  const deterministic = /^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || "");
  const suffix = crypto
    .createHash("sha256")
    .update(deterministic ? `run:${kind}:${process.pid}:${scheduleRunIdSequence}` : `run:${kind}:${stamp}:${process.pid}:${scheduleRunIdSequence}`)
    .digest("hex")
    .slice(0, 6);
  return deterministic ? `run-${kind}-${suffix}` : `run-${kind}-${stamp}-${suffix}`;
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

// Number guards for create(): an absent option (undefined/null/bare flag) is
// left undefined for the caller's default; a GIVEN option that is out of
// bounds throws a clear, named refusal (fail closed) instead of being clamped.
function requirePositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a whole number more than 0`);
  }
  return parsed;
}

// interval only: a whole number of 0 or more. 0 means "due now" (nextRunAt is
// this moment) and is a real, supported value, so it must pass; a negative or
// non-whole interval is the typo we fail closed on.
function requireNonNegativeInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a whole number of 0 or more`);
  }
  return parsed;
}

function requirePositive(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a number more than 0`);
  }
  return parsed;
}

function requireNonNegative(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a number of 0 or more`);
  }
  return parsed;
}

// Fail closed on a store written by a newer/unknown runtime: forcing it to v1
// would silently drop fields it does not understand. A missing schemaVersion is
// treated as legacy v1 for backward tolerance.
function ensureKnownSchemaVersion(value: { schemaVersion?: unknown }, store: string): void {
  const version = value.schemaVersion;
  if (version !== undefined && version !== 1) {
    throw new Error(`Unsupported ${store} store schemaVersion: ${String(version)}`);
  }
}

// A stored date that parses to NaN is corrupt. `NaN <= now` is false, which
// would make such a task silently never fire and never expire; fail closed by
// treating a corrupt date as already reached (due / expired), never inert.
function reachedBy(iso: string, now: Date): boolean {
  const at = new Date(iso).getTime();
  return Number.isNaN(at) || at <= now.getTime();
}

// ---------------------------------------------------------------------------
// DesktopSchedulerDaemon — cw schedule daemon (the tick logic itself; a
// real forever-loop only under `run()`, unused by conformance).
// ---------------------------------------------------------------------------

export interface DaemonOptions {
  cwd?: string;
  intervalSeconds?: number;
  once?: boolean;
}

export interface DaemonTickResult {
  checkedAt: string;
  dueCount: number;
  dueIds: string[];
  inboxPath: string;
}

export class DesktopSchedulerDaemon {
  cwd: string;
  intervalSeconds: number;
  scheduler: Scheduler;

  constructor(options: DaemonOptions = {}) {
    this.cwd = path.resolve(String(options.cwd || process.cwd()));
    this.intervalSeconds = Number(options.intervalSeconds || 60);
    this.scheduler = new Scheduler(this.cwd);
  }

  tick(): DaemonTickResult {
    const due = this.scheduler.due();
    const checkedAt = new Date().toISOString();
    const inboxPath = path.join(this.cwd, ".cw", "schedules", "due-inbox.json");
    writeJson(inboxPath, { schemaVersion: 1, checkedAt, due });
    return { checkedAt, dueCount: due.length, dueIds: due.map((task) => task.id), inboxPath };
  }

  /** One tick, guarded. A long-running daemon must survive a transient
   *  failure — chiefly file-lock contention when a concurrent `cw schedule`
   *  command holds tasks.json (withFileLock gives up after ~6s). Returns
   *  true to keep going, false to stop the daemon cleanly.
   *  - lock contention → warn to STDERR (stdout stays pure NDJSON), keep going;
   *  - any other error (e.g. a corrupt tasks.json) → one `cw:` line + stop,
   *    a clean fail-closed shutdown instead of a raw stack dump. */
  private safeTick(): boolean {
    try {
      process.stdout.write(`${JSON.stringify(this.tick())}\n`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/could not acquire file lock/i.test(message)) {
        process.stderr.write(`cw: schedule daemon: skipped a tick (${message})\n`);
        return true;
      }
      process.stderr.write(`cw: ${message}\n`);
      process.exitCode = 1;
      return false;
    }
  }

  async run(): Promise<void> {
    fs.mkdirSync(path.join(this.cwd, ".cw", "schedules"), { recursive: true });
    if (!this.safeTick()) return;
    const timer = setInterval(() => {
      if (!this.safeTick()) clearInterval(timer);
    }, Math.max(1, this.intervalSeconds) * 1000);
  }
}

// ---------------------------------------------------------------------------
// RoutineTriggerBridge — cw routine
// ---------------------------------------------------------------------------

export type RoutineTriggerKind = "api" | "github";

export interface RoutineTrigger {
  id: string;
  kind: RoutineTriggerKind;
  createdAt: string;
  updatedAt: string;
  source: string;
  prompt: string;
  workflowId?: string;
  runId?: string;
  match?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RoutineTriggerEvent {
  id: string;
  triggerId: string;
  kind: RoutineTriggerKind;
  receivedAt: string;
  matched: boolean;
  prompt?: string;
  payloadPath: string;
}

export interface RoutineTriggerStore {
  schemaVersion: 1;
  triggers: RoutineTrigger[];
  events: RoutineTriggerEvent[];
  nextTriggerSeq?: number;
}

export class RoutineTriggerBridge {
  cwd: string;
  storePath: string;
  payloadsDir: string;

  constructor(cwd = process.cwd()) {
    this.cwd = path.resolve(cwd);
    this.storePath = path.join(this.cwd, ".cw", "routines", "triggers.json");
    this.payloadsDir = path.join(this.cwd, ".cw", "routines", "payloads");
  }

  private locked<T>(fn: () => T): T {
    return withFileLock(this.storePath, fn);
  }

  create(options: Record<string, unknown>): RoutineTrigger {
    return this.locked(() => {
      const now = new Date().toISOString();
      const store = this.load();
      // Monotonic id, NOT triggers.length: delete shrinks the collection, so
      // a length-based seq would reuse a live id after delete+create.
      const seq = (store.nextTriggerSeq || 0) + 1;
      store.nextTriggerSeq = seq;
      const trigger: RoutineTrigger = {
        id: createTriggerId(normalizeTriggerKind(options.kind), seq),
        kind: normalizeTriggerKind(options.kind),
        createdAt: now,
        updatedAt: now,
        source: String(options.source || options.kind || "api"),
        prompt: requiredString(options.prompt, "prompt"),
        workflowId: stringOption(options.workflowId),
        runId: stringOption(options.runId),
        match: parseJsonObject(options.match),
        metadata: parseJsonObject(options.metadata),
      };
      store.triggers.push(trigger);
      this.save(store);
      return trigger;
    });
  }

  list(kind?: string): RoutineTrigger[] {
    const store = this.load();
    return kind ? store.triggers.filter((trigger) => trigger.kind === kind) : store.triggers;
  }

  delete(id: string): { deleted: boolean; id: string } {
    return this.locked(() => {
      const store = this.load();
      const before = store.triggers.length;
      store.triggers = store.triggers.filter((trigger) => trigger.id !== id);
      this.save(store);
      return { deleted: store.triggers.length !== before, id };
    });
  }

  fire(kind: string, payload: unknown): RoutineTriggerEvent[] {
    return this.locked(() => {
      const normalizedKind = normalizeTriggerKind(kind);
      const store = this.load();
      const now = new Date().toISOString();
      const base = store.events.length;
      const events = store.triggers
        .filter((trigger) => trigger.kind === normalizedKind)
        .map((trigger, index) => this.createEvent(trigger, payload, now, base + index + 1));
      store.events.push(...events);
      this.save(store);
      return events;
    });
  }

  events(triggerId?: string): RoutineTriggerEvent[] {
    const store = this.load();
    return triggerId ? store.events.filter((event) => event.triggerId === triggerId) : store.events;
  }

  private createEvent(trigger: RoutineTrigger, payload: unknown, receivedAt: string, seq: number): RoutineTriggerEvent {
    const matched = matchesTrigger(trigger.match, payload);
    const eventId = createEventId(trigger.kind, seq);
    const payloadPath = path.join(this.payloadsDir, `${safeFileName(eventId)}.json`);
    writeJson(payloadPath, { schemaVersion: 1, trigger, receivedAt, matched, payload });
    return {
      id: eventId,
      triggerId: trigger.id,
      kind: trigger.kind,
      receivedAt,
      matched,
      prompt: matched ? renderPrompt(trigger, payload) : undefined,
      payloadPath,
    };
  }

  private load(): RoutineTriggerStore {
    if (!fs.existsSync(this.storePath)) return { schemaVersion: 1, triggers: [], events: [], nextTriggerSeq: 0 };
    const value = readJson(this.storePath) as RoutineTriggerStore;
    ensureKnownSchemaVersion(value, "routine");
    const triggers = Array.isArray(value.triggers) ? value.triggers : [];
    const maxExisting = triggers.reduce((max, trigger) => {
      const n = Number((String(trigger.id).match(/(\d+)$/) || [])[1] || 0);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return {
      schemaVersion: 1,
      triggers,
      events: Array.isArray(value.events) ? value.events : [],
      nextTriggerSeq: Math.max(typeof value.nextTriggerSeq === "number" ? value.nextTriggerSeq : 0, maxExisting),
    };
  }

  private save(store: RoutineTriggerStore): void {
    writeJson(this.storePath, store);
  }
}

function normalizeTriggerKind(value: unknown): RoutineTriggerKind {
  const kind = String(value || "api");
  if (kind === "api" || kind === "github") return kind;
  throw new Error(`Unsupported routine trigger kind: ${kind}`);
}

function matchesTrigger(match: Record<string, unknown> | undefined, payload: unknown): boolean {
  if (!match || !Object.keys(match).length) return true;
  if (!payload || typeof payload !== "object") return false;
  return Object.entries(match).every(([key, expected]) => deepValue(payload, key) === expected);
}

function deepValue(value: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function renderPrompt(trigger: RoutineTrigger, payload: unknown): string {
  return `${trigger.prompt}\n\ncw:routine\n${JSON.stringify(
    { triggerId: trigger.id, kind: trigger.kind, source: trigger.source, workflowId: trigger.workflowId, runId: trigger.runId, payload },
    null,
    2
  )}`;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || value === true) return undefined;
  if (typeof value === "object") return value as Record<string, unknown>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value)) as unknown;
  } catch {
    throw new Error("Expected a JSON object, got invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function createTriggerId(kind: RoutineTriggerKind, seq: number): string {
  return `${kind}-${String(seq).padStart(4, "0")}`;
}

function createEventId(kind: RoutineTriggerKind, seq: number): string {
  return `event-${kind}-${String(seq).padStart(4, "0")}`;
}

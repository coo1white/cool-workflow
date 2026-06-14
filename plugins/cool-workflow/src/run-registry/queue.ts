// Durable run-queue operations for the run registry (FreeBSD-audit R2 deep).
// Carved out of run-registry.ts so the RunRegistry class no longer bundles the
// stateful queue cluster; the class keeps the public methods as thin delegators.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function
// takes a `QueueHost` (the registry, narrowed to exactly the file-access +
// repo-registration helpers the queue needs) so it stays a function of its
// inputs, matching the existing router pattern (orchestrator/*-operations.ts,
// run-registry/derive.ts + format.ts).
//
// The queue file lives beside the other home-registry plain files (EXPLICIT,
// INSPECTABLE STATE): readable, diffable, no hidden database. Cross-process
// read-modify-write is locked (v0.1.40, P1-D) so a concurrent add/drain can
// never drop or double-drain an entry.
import path from "node:path";
import fs from "node:fs";
import { RunQueueEntry } from "../types";
import { readJson, withFileLock, writeJson } from "../state";
import { clampInt, compareQueue, queueId } from "./derive";

interface QueueFile {
  schemaVersion: 1;
  entries: RunQueueEntry[];
}

/** The narrow slice of RunRegistry the queue cluster needs. The class satisfies
 *  this structurally; nothing here reaches into private state directly. */
export interface QueueHost {
  readonly repoRoot: string;
  readonly defaultQueuePriority: number;
  homeRegistryDir(): string;
  registerRepo(repo?: string): { registered: boolean; repos: string[] };
}

export function queueFilePath(host: QueueHost): string {
  return path.join(host.homeRegistryDir(), "queue.json");
}

export function loadQueue(host: QueueHost): RunQueueEntry[] {
  const file = queueFilePath(host);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = readJson(file) as QueueFile;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function saveQueue(host: QueueHost, entries: RunQueueEntry[]): void {
  writeJson(queueFilePath(host), { schemaVersion: 1, entries }, { durable: true });
}

export function queueAdd(
  host: QueueHost,
  options: {
    runId?: string;
    appId?: string;
    workflowId?: string;
    repo?: string;
    priority?: number;
    inputs?: Record<string, unknown>;
    note?: string;
    id?: string;
  } = {}
): RunQueueEntry {
  const repo = options.repo ? path.resolve(options.repo) : host.repoRoot;
  // Cross-process read-modify-write on the home queue: lock so a concurrently
  // added task can never vanish (v0.1.40, P1-D).
  return withFileLock(queueFilePath(host), () => {
    const entries = loadQueue(host);
    const entry: RunQueueEntry = {
      schemaVersion: 1,
      id: options.id || queueId(),
      runId: options.runId,
      appId: options.appId,
      workflowId: options.workflowId,
      repo,
      priority: Number.isFinite(options.priority) ? Number(options.priority) : host.defaultQueuePriority,
      enqueuedAt: new Date().toISOString(),
      status: "pending",
      inputs: options.inputs,
      note: options.note
    };
    entries.push(entry);
    host.registerRepo(repo);
    saveQueue(host, entries);
    return entry;
  });
}

export function queueList(
  host: QueueHost,
  options: { status?: RunQueueEntry["status"]; repo?: string } = {}
): { schemaVersion: 1; total: number; entries: RunQueueEntry[] } {
  let entries = loadQueue(host);
  if (options.status) entries = entries.filter((e) => e.status === options.status);
  if (options.repo) {
    const repo = path.resolve(options.repo);
    entries = entries.filter((e) => path.resolve(e.repo) === repo);
  }
  entries = [...entries].sort(compareQueue);
  return { schemaVersion: 1, total: entries.length, entries };
}

export function queueShow(host: QueueHost, id: string): RunQueueEntry {
  const entry = loadQueue(host).find((e) => e.id === id);
  if (!entry) throw new Error(`Queue entry not found: ${id}`);
  return entry;
}

/** Drain the next N ready/pending entries in policy order, marking them drained.
 *  CW records readiness/order; the HOST still executes the workers. */
export function queueDrain(
  host: QueueHost,
  options: { limit?: number; repo?: string } = {}
): { schemaVersion: 1; drained: RunQueueEntry[]; remaining: number } {
  const limit = clampInt(options.limit, 1, 1);
  const repoFilter = options.repo ? path.resolve(options.repo) : undefined;
  // Lock the drain RMW so two hosts can never double-drain the same entry
  // (v0.1.40, P1-D — the scheduling kernel's concurrency ceiling now holds
  // across processes, not just within one).
  return withFileLock(queueFilePath(host), () => {
    const entries = loadQueue(host);
    const drainable = entries
      .filter((e) => e.status === "pending" || e.status === "ready")
      .filter((e) => !repoFilter || path.resolve(e.repo) === repoFilter)
      .sort(compareQueue);
    const drained: RunQueueEntry[] = [];
    const drainedAt = new Date().toISOString();
    for (const entry of drainable.slice(0, limit)) {
      entry.status = "drained";
      entry.drainedAt = drainedAt;
      drained.push(entry);
    }
    saveQueue(host, entries);
    const remaining = entries.filter((e) => e.status === "pending" || e.status === "ready").length;
    return { schemaVersion: 1, drained, remaining };
  });
}

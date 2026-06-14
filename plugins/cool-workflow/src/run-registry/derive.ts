// Pure, stateless helpers for the run registry — comparison, query matching,
// input digesting, counting, and small utilities. Carved out of run-registry.ts
// (FreeBSD-audit R2) so the stateful RunRegistry class no longer bundles the pure
// derivation layer. Nothing here touches `this`; everything is a pure function of
// its arguments (queueId is the lone exception — a process-local counter, kept as
// it was; making ID minting deterministic is a separate tracked item).
import fs from "node:fs";
import path from "node:path";
import { compareBytes } from "../compare";
import {
  ReclaimedOverlay,
  RunLifecycleState,
  RunQueueEntry,
  RunRecord,
  RunRegistryCounts,
  RunSearchQuery,
  WorkflowRun
} from "../types";

export const LIFECYCLE_STATES: RunLifecycleState[] = [
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "archived",
  "reclaimed"
];

export function compareRecords(a: RunRecord, b: RunRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return compareBytes(a.runId, b.runId);
}

export function compareHistory(a: RunRecord, b: RunRecord): number {
  // Newest first.
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return compareBytes(a.runId, b.runId);
}

export function compareQueue(a: RunQueueEntry, b: RunQueueEntry): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
  return compareBytes(a.id, b.id);
}

export function matchesQuery(record: RunRecord, query: RunSearchQuery): boolean {
  if (query.app && !(record.appId || record.workflowId || "").toLowerCase().includes(query.app)) return false;
  if (query.status && record.lifecycle !== query.status && record.derivedLifecycle !== query.status) return false;
  if (query.repo && path.resolve(record.repo) !== query.repo) return false;
  if (query.since && record.createdAt < query.since) return false;
  if (query.until && record.createdAt > query.until) return false;
  if (query.text) {
    const haystack = [
      record.runId,
      record.appId,
      record.workflowId,
      record.title,
      record.repo,
      record.lifecycle,
      record.loopStage,
      record.inputsDigest
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query.text)) return false;
  }
  return true;
}

/** Bounded, deterministic stringification of run inputs for free-text search.
 *  Descriptive intent keys (question, prompt, ...) come first so they survive
 *  truncation; the rest follow alphabetically. Deterministic and compact. */
const DIGEST_PRIORITY_KEYS = ["question", "prompt", "task", "summary", "title", "objective", "focus", "topic"];

/** Distinct execution backends used by a run's dispatches/tasks, recomputed from
 *  source state. Sorted; empty for pre-v0.1.29 / default-only runs that never
 *  recorded a backend. The registry stays backend-agnostic — this is metadata. */
export function distinctBackends(run: WorkflowRun): string[] {
  const backends = new Set<string>();
  for (const dispatch of run.dispatches || []) {
    if (dispatch.backendId) backends.add(dispatch.backendId);
  }
  for (const task of run.tasks || []) {
    if (task.backendId) backends.add(task.backendId);
  }
  return [...backends].sort();
}

export function digestInputs(inputs: Record<string, unknown> | undefined): string | undefined {
  if (!inputs || typeof inputs !== "object") return undefined;
  const keys = Object.keys(inputs);
  const ordered = [
    ...DIGEST_PRIORITY_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !DIGEST_PRIORITY_KEYS.includes(k)).sort()
  ];
  const parts: string[] = [];
  for (const key of ordered) {
    const value = inputs[key];
    if (value === undefined || value === null) continue;
    const rendered = Array.isArray(value) ? value.join(",") : typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}=${rendered}`);
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > 360 ? `${joined.slice(0, 357)}...` : joined;
}

export function countRecords(records: RunRecord[]): RunRegistryCounts {
  const counts: RunRegistryCounts = {
    total: records.length,
    queued: 0,
    running: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
    archived: 0,
    reclaimed: 0
  };
  for (const record of records) {
    counts[record.lifecycle] = (counts[record.lifecycle] || 0) + 1;
  }
  return counts;
}

export function optionalLower(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).toLowerCase();
}

export function clampInt(value: unknown, fallback: number, min: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

let queueCounter = 0;
export function queueId(): string {
  queueCounter += 1;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `q-${stamp}-${String(queueCounter).padStart(3, "0")}`;
}

export function isRunLifecycleState(value: unknown): value is RunLifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as string[]).includes(value);
}

/** Read a run dir's `reclaimed.json` overlay (v0.1.39). Fail-closed to an empty
 *  chain on absence/corruption — a malformed overlay must never brick the run. */
export function loadReclaimedFromDir(runDir: string): ReclaimedOverlay {
  const file = path.join(runDir, "reclaimed.json");
  if (!fs.existsSync(file)) return { schemaVersion: 1, runId: "", tombstones: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ReclaimedOverlay;
    return { schemaVersion: 1, runId: parsed.runId || "", tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [] };
  } catch {
    return { schemaVersion: 1, runId: "", tombstones: [] };
  }
}

// shell/scheduling-io.ts — Control-Plane Scheduling (`cw sched`): pure
// lease-plan mechanism over the run-registry-io.ts queue store, plus the
// policy file IO.
//
// MILESTONE 10 (docs/rebuild/PLAN.md build order, step 10). Byte-exact port of the
// old build's src/scheduling.ts + the sched-specific slice of
// src/capability-core.ts. `sched` is a DIFFERENT system from `schedule`
// (see scheduler-io.ts's file header) — this operates on
// `$CW_HOME/registry/queue.json` leases, not wall-clock tasks.
//
// Evidence: SPEC/scheduling-registry.md section D;
// plugins/cool-workflow/src/scheduling.ts (byte-exact source).

import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, withFileLock, writeJson } from "./fs-atomic";
import { compareQueue, RunQueueEntry, RunRegistry } from "./run-registry-io";
import { requiredNumberFlag } from "../core/util/numeric-flag";

export const SCHEDULING_SCHEMA_VERSION = 1;

export interface SchedulingPolicy {
  schemaVersion: 1;
  maxConcurrent: number;
  maxAttempts: number;
  leaseTtlMs: number;
  backoffBaseMs: number;
  backoffFactor: number;
  backoffCapMs: number;
}

export interface SchedulingLease {
  id: string;
  leaseId: string;
  leaseExpiresAt: string;
  attempts: number;
  priority: number;
}

export interface SchedulingSkip {
  id: string;
  reason: "concurrency-ceiling" | "parked" | "backoff" | "leased" | "terminal";
}

export interface SchedulingLeasePlan {
  schemaVersion: 1;
  now: string;
  maxConcurrent: number;
  inFlight: number;
  available: number;
  leases: SchedulingLease[];
  skipped: SchedulingSkip[];
}

export interface SchedulingPolicyReport {
  schemaVersion: 1;
  policy: SchedulingPolicy;
  source: "default" | "file";
}

/** Conservative fail-closed defaults: serial, bounded retries, exponential backoff. */
export const DEFAULT_SCHEDULING_POLICY: SchedulingPolicy = {
  schemaVersion: 1,
  maxConcurrent: 1,
  maxAttempts: 3,
  leaseTtlMs: 300_000,
  backoffBaseMs: 1_000,
  backoffFactor: 2,
  backoffCapMs: 60_000,
};

export function normalizeSchedulingPolicy(input: Partial<SchedulingPolicy> | undefined): SchedulingPolicy {
  const base = DEFAULT_SCHEDULING_POLICY;
  const num = (value: unknown, fallback: number, min: number) => (typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback);
  return {
    schemaVersion: 1,
    maxConcurrent: num(input?.maxConcurrent, base.maxConcurrent, 1),
    maxAttempts: num(input?.maxAttempts, base.maxAttempts, 1),
    leaseTtlMs: num(input?.leaseTtlMs, base.leaseTtlMs, 1),
    backoffBaseMs: num(input?.backoffBaseMs, base.backoffBaseMs, 0),
    backoffFactor: num(input?.backoffFactor, base.backoffFactor, 1),
    backoffCapMs: num(input?.backoffCapMs, base.backoffCapMs, 0),
  };
}

/** Deterministic backoff: baseMs * factor^(attempts-1), capped. No jitter. */
export function backoffMs(policy: SchedulingPolicy, attempts: number): number {
  const raw = policy.backoffBaseMs * Math.pow(policy.backoffFactor, Math.max(0, attempts - 1));
  return Math.min(Math.round(raw), policy.backoffCapMs);
}

function addMs(now: string, ms: number): string {
  return new Date(new Date(now).getTime() + ms).toISOString();
}

function leaseActive(entry: RunQueueEntry, now: string): boolean {
  return entry.status === "leased" && Boolean(entry.leaseExpiresAt) && (entry.leaseExpiresAt as string) > now;
}

function leaseExpired(entry: RunQueueEntry, now: string): boolean {
  return entry.status === "leased" && (!entry.leaseExpiresAt || (entry.leaseExpiresAt as string) <= now);
}

function eligible(entry: RunQueueEntry, now: string): boolean {
  if (entry.status !== "pending" && entry.status !== "ready") return false;
  if (entry.nextEligibleAt && entry.nextEligibleAt > now) return false;
  return true;
}

/** Read-only lease plan for the current queue + policy + now. Pure: no mutation. */
export function planSchedule(entries: RunQueueEntry[], policy: SchedulingPolicy, now: string): SchedulingLeasePlan {
  const sorted = [...entries].sort(compareQueue);
  const inFlight = sorted.filter((entry) => leaseActive(entry, now)).length;
  const available = Math.max(0, policy.maxConcurrent - inFlight);
  const leases: SchedulingLease[] = [];
  const skipped: SchedulingSkip[] = [];

  for (const entry of sorted) {
    if (leaseActive(entry, now)) continue;
    if (entry.status === "parked") {
      skipped.push({ id: entry.id, reason: "parked" });
      continue;
    }
    if (entry.status === "drained" || entry.status === "cancelled") {
      skipped.push({ id: entry.id, reason: "terminal" });
      continue;
    }
    if (!eligible(entry, now)) {
      skipped.push({ id: entry.id, reason: leaseExpired(entry, now) ? "leased" : "backoff" });
      continue;
    }
    if (leases.length >= available) {
      skipped.push({ id: entry.id, reason: "concurrency-ceiling" });
      continue;
    }
    leases.push({
      id: entry.id,
      leaseId: `lease-${entry.id}-${(entry.attempts || 0) + 1}-${now.replace(/[^0-9]/g, "")}`,
      leaseExpiresAt: addMs(now, policy.leaseTtlMs),
      attempts: entry.attempts || 0,
      priority: entry.priority,
    });
  }
  return { schemaVersion: 1, now, maxConcurrent: policy.maxConcurrent, inFlight, available, leases, skipped };
}

export function applyLease(entries: RunQueueEntry[], policy: SchedulingPolicy, now: string, limit?: number): { entries: RunQueueEntry[]; leases: SchedulingLease[] } {
  const plan = planSchedule(entries, policy, now);
  const granted = typeof limit === "number" ? plan.leases.slice(0, Math.max(0, limit)) : plan.leases;
  const byId = new Map(granted.map((lease) => [lease.id, lease]));
  const next = entries.map((entry) => {
    const lease = byId.get(entry.id);
    if (!lease) return entry;
    return { ...entry, status: "leased" as const, leaseId: lease.leaseId, leaseExpiresAt: lease.leaseExpiresAt };
  });
  return { entries: next, leases: granted };
}

/** A failed/expired attempt: increment attempts, then park (at budget) or
 *  set ready with backoff. Fail closed — parked is terminal until reset. */
export function retryOrPark(entry: RunQueueEntry, policy: SchedulingPolicy, now: string, reason: string): RunQueueEntry {
  const attempts = (entry.attempts || 0) + 1;
  const cleared = { ...entry, attempts, leaseId: undefined, leaseExpiresAt: undefined };
  if (attempts >= policy.maxAttempts) {
    return { ...cleared, status: "parked", parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
  }
  return { ...cleared, status: "ready", nextEligibleAt: addMs(now, backoffMs(policy, attempts)) };
}

export function reclaimExpired(entries: RunQueueEntry[], policy: SchedulingPolicy, now: string): { entries: RunQueueEntry[]; reclaimed: string[] } {
  const reclaimed: string[] = [];
  const next = entries.map((entry) => {
    if (!leaseExpired(entry, now)) return entry;
    reclaimed.push(entry.id);
    return retryOrPark(entry, policy, now, "lease expired (host did not complete)");
  });
  return { entries: next, reclaimed };
}

export function leaseComplete(entries: RunQueueEntry[], leaseId: string, now: string): { entries: RunQueueEntry[]; matched: boolean } {
  let matched = false;
  const next = entries.map((entry) => {
    if (entry.leaseId !== leaseId || entry.status !== "leased") return entry;
    matched = true;
    return { ...entry, status: "drained" as const, drainedAt: now, leaseId: undefined, leaseExpiresAt: undefined };
  });
  return { entries: next, matched };
}

export function leaseRelease(
  entries: RunQueueEntry[],
  leaseId: string,
  policy: SchedulingPolicy,
  now: string,
  options: { failed?: boolean; reason?: string } = {}
): { entries: RunQueueEntry[]; matched: boolean } {
  let matched = false;
  const next = entries.map((entry) => {
    if (entry.leaseId !== leaseId || entry.status !== "leased") return entry;
    matched = true;
    if (options.failed) return retryOrPark(entry, policy, now, options.reason || "released as failed");
    return { ...entry, status: "ready" as const, leaseId: undefined, leaseExpiresAt: undefined };
  });
  return { entries: next, matched };
}

export function resetEntry(entries: RunQueueEntry[], id: string): { entries: RunQueueEntry[]; matched: boolean } {
  let matched = false;
  const next = entries.map((entry) => {
    if (entry.id !== id || entry.status !== "parked") return entry;
    matched = true;
    return { ...entry, status: "ready" as const, attempts: 0, nextEligibleAt: undefined, parkedReason: undefined };
  });
  return { entries: next, matched };
}

// ---------------------------------------------------------------------------
// Impure CLI-facing ops: policy file IO + the queue read-modify-write.
// Byte-exact port of the `sched`-specific slice of src/capability-core.ts.
// ---------------------------------------------------------------------------

function resolveCwd(options: Record<string, unknown>): string {
  return path.resolve(String(options.cwd || process.cwd()));
}

function nowIso(options: Record<string, unknown>): string {
  return typeof options.now === "string" ? options.now : new Date().toISOString();
}

/** Loads the scheduling policy: absent = default; present-but-corrupt
 *  FAILS CLOSED (SPEC "Rebuild risks" #1 — this store is authoritative). */
function loadSchedulingPolicy(registry: RunRegistry): SchedulingPolicyReport {
  const file = registry.schedulingPolicyPath();
  if (!fs.existsSync(file)) return { schemaVersion: 1, policy: DEFAULT_SCHEDULING_POLICY, source: "default" };
  const parsed = readJson(file) as Partial<SchedulingPolicy>;
  return { schemaVersion: 1, policy: normalizeSchedulingPolicy(parsed), source: "file" };
}

function numericFlag(options: Record<string, unknown>, key: string): number | undefined {
  return requiredNumberFlag(options[key], `--${key}`);
}

export function schedPlanCli(options: Record<string, unknown> = {}): SchedulingLeasePlan {
  const registry = new RunRegistry(resolveCwd(options));
  const { policy } = loadSchedulingPolicy(registry);
  return planSchedule(registry.loadQueueEntries(), policy, nowIso(options));
}

export function schedLeaseCli(options: Record<string, unknown> = {}): { schemaVersion: 1; now: string; granted: number; leases: SchedulingLease[] } {
  const registry = new RunRegistry(resolveCwd(options));
  const now = nowIso(options);
  const policy = loadSchedulingPolicy(registry).policy;
  const limit = requiredNumberFlag(options.limit, "--limit");
  return withFileLock(registry.queueFilePath(), () => {
    const { entries, leases } = applyLease(registry.loadQueueEntries(), policy, now, limit);
    registry.saveQueueEntries(entries);
    return { schemaVersion: 1, now, granted: leases.length, leases };
  });
}

export function schedReleaseCli(leaseId: string, options: Record<string, unknown> = {}): { schemaVersion: 1; released: string; failed: boolean } {
  const registry = new RunRegistry(resolveCwd(options));
  const now = nowIso(options);
  const failed = isTrue(options.failed);
  const reason = typeof options.reason === "string" ? options.reason : undefined;
  return withFileLock(registry.queueFilePath(), () => {
    const { entries, matched } = leaseRelease(registry.loadQueueEntries(), leaseId, loadSchedulingPolicy(registry).policy, now, { failed, reason });
    if (!matched) throw new Error(`No active lease to release: ${leaseId}`);
    registry.saveQueueEntries(entries);
    return { schemaVersion: 1, released: leaseId, failed };
  });
}

export function schedCompleteCli(leaseId: string, options: Record<string, unknown> = {}): { schemaVersion: 1; completed: string } {
  const registry = new RunRegistry(resolveCwd(options));
  return withFileLock(registry.queueFilePath(), () => {
    const { entries, matched } = leaseComplete(registry.loadQueueEntries(), leaseId, nowIso(options));
    if (!matched) throw new Error(`No active lease to complete: ${leaseId}`);
    registry.saveQueueEntries(entries);
    return { schemaVersion: 1, completed: leaseId };
  });
}

export function schedReclaimCli(options: Record<string, unknown> = {}): { schemaVersion: 1; now: string; reclaimed: string[] } {
  const registry = new RunRegistry(resolveCwd(options));
  const now = nowIso(options);
  return withFileLock(registry.queueFilePath(), () => {
    const { entries, reclaimed } = reclaimExpired(registry.loadQueueEntries(), loadSchedulingPolicy(registry).policy, now);
    registry.saveQueueEntries(entries);
    return { schemaVersion: 1, now, reclaimed };
  });
}

export function schedResetCli(id: string, options: Record<string, unknown> = {}): { schemaVersion: 1; reset: string } {
  const registry = new RunRegistry(resolveCwd(options));
  return withFileLock(registry.queueFilePath(), () => {
    const { entries, matched } = resetEntry(registry.loadQueueEntries(), id);
    if (!matched) throw new Error(`No parked entry to reset: ${id}`);
    registry.saveQueueEntries(entries);
    return { schemaVersion: 1, reset: id };
  });
}

export function schedPolicyShowCli(options: Record<string, unknown> = {}): SchedulingPolicyReport {
  const registry = new RunRegistry(resolveCwd(options));
  return loadSchedulingPolicy(registry);
}

export function schedPolicySetCli(options: Record<string, unknown> = {}): SchedulingPolicyReport {
  const registry = new RunRegistry(resolveCwd(options));
  const patch: Partial<SchedulingPolicy> = {};
  for (const key of ["maxConcurrent", "maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"] as const) {
    const value = numericFlag(options, key);
    if (value !== undefined) patch[key] = value;
  }
  // Read-modify-write under the policy file's own lock: two concurrent
  // `sched policy set` calls patching different fields must not drop each
  // other's write.
  return withFileLock(registry.schedulingPolicyPath(), () => {
    const current = loadSchedulingPolicy(registry).policy;
    const policy = normalizeSchedulingPolicy({ ...current, ...patch });
    writeJson(registry.schedulingPolicyPath(), policy);
    return { schemaVersion: 1, policy, source: "file" };
  });
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

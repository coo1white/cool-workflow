// Control-Plane Scheduling (v0.1.37) — policy-as-data over the v0.1.28 Run
// Registry queue. The queue has ORDER; this PURE core adds the scheduling policy:
// priority+readiness selection, a hard concurrency ceiling, leases, retry with
// computed backoff, and a fail-closed park state.
//
// BSD discipline:
//  - MECHANISM vs POLICY: these functions are mechanism; the SchedulingPolicy is
//    data (concurrency, retry budget, backoff curve, lease TTL), kept out of the
//    kernel and defaulting to conservative fail-closed values.
//  - FAIL CLOSED [load-bearing]: a concurrency ceiling is NEVER exceeded; an entry
//    at maxAttempts is PARKED and never re-selected (only `reset` recovers it) —
//    the queue can never re-hand a failing entry forever.
//  - DETERMINISTIC: every function takes an injected `now`; selection reuses the
//    registry's compareQueue; backoff is a pure curve with NO randomness. The
//    `plan` is read-only and replayable.
//  - REUSE, don't fork: operates on the existing RunQueueEntry[] from the registry
//    queue store; does not duplicate the queue file.
//
// See docs/control-plane-scheduling.7.md.

import { compareQueue } from "./run-registry";
import { RunQueueEntry, SchedulingLease, SchedulingLeasePlan, SchedulingPolicy, SchedulingSkip } from "./types";

export const SCHEDULING_SCHEMA_VERSION = 1;

/** Conservative fail-closed defaults: serial, bounded retries, exponential backoff. */
export const DEFAULT_SCHEDULING_POLICY: SchedulingPolicy = {
  schemaVersion: 1,
  maxConcurrent: 1,
  maxAttempts: 3,
  leaseTtlMs: 300_000,
  backoffBaseMs: 1_000,
  backoffFactor: 2,
  backoffCapMs: 60_000
};

export function normalizeSchedulingPolicy(input: Partial<SchedulingPolicy> | undefined): SchedulingPolicy {
  const base = DEFAULT_SCHEDULING_POLICY;
  const num = (value: unknown, fallback: number, min: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  return {
    schemaVersion: 1,
    maxConcurrent: num(input?.maxConcurrent, base.maxConcurrent, 1),
    maxAttempts: num(input?.maxAttempts, base.maxAttempts, 1),
    leaseTtlMs: num(input?.leaseTtlMs, base.leaseTtlMs, 1),
    backoffBaseMs: num(input?.backoffBaseMs, base.backoffBaseMs, 0),
    backoffFactor: num(input?.backoffFactor, base.backoffFactor, 1),
    backoffCapMs: num(input?.backoffCapMs, base.backoffCapMs, 0)
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

/** Eligible = pending/ready, not parked/terminal/leased, and past any backoff. */
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
    if (leaseActive(entry, now)) continue; // counted in inFlight
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
      priority: entry.priority
    });
  }
  return { schemaVersion: 1, now, maxConcurrent: policy.maxConcurrent, inFlight, available, leases, skipped };
}

/** Apply the plan: mark the selected entries leased. Never exceeds the ceiling.
 *  Returns the new entries + the granted leases. */
export function applyLease(
  entries: RunQueueEntry[],
  policy: SchedulingPolicy,
  now: string,
  limit?: number
): { entries: RunQueueEntry[]; leases: SchedulingLease[] } {
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

/** A failed/expired attempt: increment attempts, then park (at budget) or set
 *  ready with backoff. Fail closed — parked is terminal until reset. */
export function retryOrPark(entry: RunQueueEntry, policy: SchedulingPolicy, now: string, reason: string): RunQueueEntry {
  const attempts = (entry.attempts || 0) + 1;
  const cleared = { ...entry, attempts, leaseId: undefined, leaseExpiresAt: undefined };
  if (attempts >= policy.maxAttempts) {
    return { ...cleared, status: "parked", parkedReason: `${reason} (attempt ${attempts}/${policy.maxAttempts})` };
  }
  return { ...cleared, status: "ready", nextEligibleAt: addMs(now, backoffMs(policy, attempts)) };
}

/** Reclaim expired leases (host died): each counts as one failed attempt. */
export function reclaimExpired(
  entries: RunQueueEntry[],
  policy: SchedulingPolicy,
  now: string
): { entries: RunQueueEntry[]; reclaimed: string[] } {
  const reclaimed: string[] = [];
  const next = entries.map((entry) => {
    if (!leaseExpired(entry, now)) return entry;
    reclaimed.push(entry.id);
    return retryOrPark(entry, policy, now, "lease expired (host did not complete)");
  });
  return { entries: next, reclaimed };
}

/** Complete a lease: terminal success. */
export function leaseComplete(entries: RunQueueEntry[], leaseId: string, now: string): { entries: RunQueueEntry[]; matched: boolean } {
  let matched = false;
  const next = entries.map((entry) => {
    if (entry.leaseId !== leaseId || entry.status !== "leased") return entry;
    matched = true;
    return { ...entry, status: "drained" as const, drainedAt: now, leaseId: undefined, leaseExpiresAt: undefined };
  });
  return { entries: next, matched };
}

/** Release a lease: failed -> attempt+backoff/park; otherwise back to ready. */
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

/** Operator recovery: park -> ready, clearing attempts/backoff. The ONLY way back. */
export function resetEntry(entries: RunQueueEntry[], id: string): { entries: RunQueueEntry[]; matched: boolean } {
  let matched = false;
  const next = entries.map((entry) => {
    if (entry.id !== id || entry.status !== "parked") return entry;
    matched = true;
    return { ...entry, status: "ready" as const, attempts: 0, nextEligibleAt: undefined, parkedReason: undefined };
  });
  return { entries: next, matched };
}

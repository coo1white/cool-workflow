// Run Retention & Provable Reclamation operations (v0.1.39) for the run registry
// (FreeBSD-audit R2 deep). Carved out of run-registry.ts so the RunRegistry class
// no longer bundles the stateful GC/reclamation cluster; the class keeps gcPlan /
// gcRun / gcVerify as thin delegators.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function
// takes a `GcHost` (the registry, narrowed to exactly the resolution helpers the
// GC needs) so it stays a function of its inputs, matching the existing router
// pattern (orchestrator/*-operations.ts, run-registry/derive.ts + format.ts).
//
// A small, verifiable GC built on the archive overlay: `gc plan` is a pure
// dry-run (frees nothing); `gc run` executes the write-ahead reclamation
// transaction (skeleton -> tombstone -> fsync -> free); `gc verify` re-proves a
// reclaimed run independently. Eligibility is explicit and fail-closed.
import {
  GcPlanEntry,
  GcPlanResult,
  GcRunResult,
  GcVerifyResult,
  ReclaimRefusalCode,
  RunRecord,
  RunRegistryIndex,
  RunRegistryPolicy,
  WorkflowRun
} from "../types";
import { planReclamation, runReclamation, verifyReclamation, ReclamationError } from "../reclamation";
import { recordTrustAuditEvent, listTrustAuditEvents } from "../trust-audit";
import { DEFAULT_RUN_REGISTRY_POLICY } from "./policy";

/** The narrow slice of RunRegistry the GC cluster needs. The class satisfies
 *  this structurally; nothing here reaches into private state directly. */
export interface GcHost {
  buildIndex(scope: "repo" | "home"): RunRegistryIndex;
  locate(runId: string, scope: "repo" | "home"): { record: RunRecord; from: "repo" | "home" } | undefined;
  loadRun(repo: string, runId: string): WorkflowRun;
}

/** Resolve the effective reclamation policy (defaults reclaim NOTHING). */
export function reclamationPolicy(overrides: Partial<RunRegistryPolicy> = {}): RunRegistryPolicy {
  return { ...DEFAULT_RUN_REGISTRY_POLICY, ...overrides };
}

/** Fail-closed eligibility: terminal AND archived AND no open feedback AND past
 *  retention. Returns the matching refusal code, or null when eligible. Reads
 *  the live-source-derived record; order yields distinct, stable codes. */
export function reclaimEligibility(record: RunRecord, policy: RunRegistryPolicy, nowMs: number): ReclaimRefusalCode | null {
  if (record.tier === "reclaimed") return "already-reclaimed";
  const terminalStates = policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"];
  if (record.derivedLifecycle !== "completed" && record.derivedLifecycle !== "failed") return "non-terminal";
  if (!terminalStates.includes(record.derivedLifecycle)) return "non-terminal";
  if (record.openFeedbackCount > 0) return "open-feedback";
  if (!record.archived) return "not-archived";
  const days = policy.reclaimAfterArchiveDays ?? 0;
  if (days > 0) {
    const archivedAtMs = record.archivedAt ? Date.parse(record.archivedAt) : NaN;
    if (!Number.isFinite(archivedAtMs)) return "within-retention";
    if (archivedAtMs > nowMs - days * 24 * 60 * 60 * 1000) return "within-retention";
  }
  return null;
}

/** Resolve a single run to a one-element record list via locate() (repo-first),
 *  avoiding a full-registry scan for single-run gc plan/run. */
function recordsForRunId(host: GcHost, runId: string, scope: "repo" | "home"): RunRecord[] {
  const located = host.locate(runId, scope);
  return located ? [located.record] : [];
}

/** Dry-run: compute eligible runs, per-kind bytes that WOULD be freed, and the
 *  capability downgrade. Frees NOTHING. */
export function gcPlan(
  host: GcHost,
  options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string } = {}
): GcPlanResult {
  const scope = options.scope || "home";
  const policy = reclamationPolicy(options.policy);
  const nowIso = options.now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  // Fast, deterministic single-run path: resolve just that run via locate()
  // (repo-first) so a home-scope plan never re-scans the whole registry.
  const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
  const entries: GcPlanEntry[] = [];
  let bytesToFree = 0;
  let eligibleCount = 0;
  for (const record of records) {
    const refusal = reclaimEligibility(record, policy, nowMs);
    let plan;
    try {
      const run = host.loadRun(record.repo, record.runId);
      plan = planReclamation(run, { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots });
    } catch {
      entries.push({
        runId: record.runId,
        repo: record.repo,
        eligible: false,
        reason: "unreadable",
        tier: record.tier || "live",
        capability: record.capability || "re-runnable",
        capabilityReason: record.capabilityReason || "live-full",
        bytesToFree: 0,
        byKind: {},
        freeable: []
      });
      continue;
    }
    const eligible = refusal === null;
    const entry: GcPlanEntry = {
      runId: record.runId,
      repo: record.repo,
      eligible,
      reason: eligible ? "eligible" : refusal!,
      tier: record.tier || "live",
      capability: plan.capability,
      capabilityReason: plan.capabilityReason,
      bytesToFree: eligible ? plan.bytesToFree : 0,
      byKind: eligible ? plan.byKind : {},
      freeable: eligible ? plan.freeable.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes })) : []
    };
    entries.push(entry);
    if (eligible) {
      eligibleCount += 1;
      bytesToFree += plan.bytesToFree;
    }
  }
  return {
    schemaVersion: 1,
    scope,
    generatedAt: nowIso,
    policy: {
      reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays ?? 0,
      keepSnapshots: Boolean(policy.keepSnapshots),
      keepScratch: Boolean(policy.keepScratch),
      reclaimStates: policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"]
    },
    total: entries.length,
    eligibleCount,
    bytesToFree,
    entries,
    nextAction: eligibleCount ? "node scripts/cw.js gc run" : "node scripts/cw.js run search"
  };
}

/** Execute the write-ahead reclamation transaction for eligible runs. Bounded
 *  (`maxReclaimRuns` / `maxReclaimBytes`), fail-closed on any incomplete
 *  skeleton. Produces a tombstone and frees the bulk. */
export function gcRun(
  host: GcHost,
  options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string; actor?: string; limit?: number } = {}
): GcRunResult {
  const scope = options.scope || "home";
  const policy = reclamationPolicy(options.policy);
  const nowIso = options.now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
  const maxRuns = options.limit ?? (policy.maxReclaimRuns || 0);
  const maxBytes = policy.maxReclaimBytes || 0;
  const reclaimed: GcRunResult["reclaimed"] = [];
  const refused: GcRunResult["refused"] = [];
  let totalBytesFreed = 0;
  for (const record of records) {
    const refusal = reclaimEligibility(record, policy, nowMs);
    if (refusal) {
      refused.push({ runId: record.runId, code: refusal });
      continue;
    }
    if (maxRuns > 0 && reclaimed.length >= maxRuns) break;
    let run: WorkflowRun;
    try {
      run = host.loadRun(record.repo, record.runId);
    } catch {
      refused.push({ runId: record.runId, code: "unreadable" });
      continue;
    }
    try {
      const result = runReclamation(run, {
        now: nowIso,
        actor: options.actor,
        policy: { reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays, keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots },
        reclaimPolicy: { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots }
      });
      // No post-free saveCheckpoint: runReclamation now DURABLY persists the
      // result-node re-point inside the transaction (before any byte is freed),
      // so state.json can never reference a freed path even on a crash here.
      reclaimed.push({
        runId: record.runId,
        bytesFreed: result.bytesFreed,
        tombstoneHash: result.tombstone.tombstoneHash,
        capability: result.tombstone.capability,
        capabilityReason: result.tombstone.capabilityReason
      });
      // Independent reclamation WITNESS in the tamper-evident trust-audit chain:
      // proves this run WAS reclaimed even if reclaimed.json is later deleted — so
      // `gc verify` can tell proof-deletion apart from never-reclaimed.
      recordTrustAuditEvent(run, {
        kind: "run.reclaimed",
        decision: "recorded",
        source: "cw-validated",
        metadata: { tombstoneHash: result.tombstone.tombstoneHash, bytesFreed: result.bytesFreed, capability: result.tombstone.capability }
      });
      totalBytesFreed += result.bytesFreed;
      if (maxBytes > 0 && totalBytesFreed >= maxBytes) break;
    } catch (error) {
      if (error instanceof ReclamationError) refused.push({ runId: record.runId, code: error.code as ReclaimRefusalCode });
      else throw error;
    }
  }
  return {
    schemaVersion: 1,
    scope,
    generatedAt: nowIso,
    dryRun: false,
    reclaimed,
    refused,
    totalBytesFreed,
    nextAction: reclaimed.length ? "node scripts/cw.js gc verify <run-id>" : "node scripts/cw.js gc plan"
  };
}

/** Re-prove a reclaimed run: skeleton schema-complete, tombstone chain
 *  recomputed-and-untampered, each reconstructable artifact re-derived from its
 *  RETAINED inputs to its expectDigest, and eligible-when-reclaimed. */
export function gcVerify(host: GcHost, runId: string, options: { scope?: "repo" | "home" } = {}): GcVerifyResult {
  const scope = options.scope || "home";
  const located = host.locate(runId, scope);
  if (!located) {
    return {
      schemaVersion: 1,
      runId,
      reclaimed: false,
      verified: false,
      tier: "live",
      capability: "re-runnable",
      chainLength: 0,
      checks: [{ name: "located", pass: false, code: "not-reclaimed", detail: "run source not found" }],
      nextAction: "node scripts/cw.js registry refresh" + (scope === "home" ? " --scope home" : "")
    };
  }
  const run = host.loadRun(located.record.repo, runId);
  const result = verifyReclamation(run);
  const checks = result.checks.map((c) => ({ name: c.name, pass: c.pass, code: c.code as GcVerifyResult["checks"][number]["code"], detail: c.detail }));
  // Eligible-when-reclaimed: each tombstone must have sealed a terminal verdict.
  let eligibleWhenReclaimed = result.reclaimed;
  for (const tombstone of result.tombstones) {
    const terminal = tombstone.skeleton.finalVerdict?.terminal === true;
    if (!terminal) {
      eligibleWhenReclaimed = false;
      checks.push({ name: `eligible-when-reclaimed:${tombstone.tombstoneId}`, pass: false, code: "ineligible-when-reclaimed", detail: "non-terminal verdict sealed" });
    }
  }
  const last = result.tombstones[result.tombstones.length - 1];
  // Independent witness: a trust-audit "run.reclaimed" event proves this run was
  // reclaimed even if reclaimed.json was deleted. A present witness + missing proof
  // = the proof was deleted/tampered (NOT "never reclaimed") — fail closed so
  // `gc verify <run> && deploy` cannot pass on a wiped reclamation record.
  const witnessed = listTrustAuditEvents(run).some((event) => event.kind === "run.reclaimed");
  const proofDeleted = witnessed && !result.reclaimed;
  if (proofDeleted) {
    checks.push({ name: "reclaim-witness", pass: false, code: "reclaim-proof-deleted", detail: "trust-audit attests reclamation but reclaimed.json is missing/empty" });
  }
  const reclaimed = result.reclaimed || proofDeleted;
  const verified = result.verified && eligibleWhenReclaimed && !proofDeleted;
  return {
    schemaVersion: 1,
    runId,
    reclaimed,
    verified,
    tier: located.record.tier || (reclaimed ? "reclaimed" : "live"),
    capability: located.record.capability || "re-runnable",
    capabilityReason: located.record.capabilityReason,
    tombstoneHash: last?.tombstoneHash,
    chainLength: result.tombstones.length,
    checks,
    nextAction: verified ? "node scripts/cw.js run show " + runId : "node scripts/cw.js gc plan"
  };
}

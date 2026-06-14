"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reclamationPolicy = reclamationPolicy;
exports.reclaimEligibility = reclaimEligibility;
exports.gcPlan = gcPlan;
exports.gcRun = gcRun;
exports.gcVerify = gcVerify;
const reclamation_1 = require("../reclamation");
const policy_1 = require("./policy");
/** Resolve the effective reclamation policy (defaults reclaim NOTHING). */
function reclamationPolicy(overrides = {}) {
    return { ...policy_1.DEFAULT_RUN_REGISTRY_POLICY, ...overrides };
}
/** Fail-closed eligibility: terminal AND archived AND no open feedback AND past
 *  retention. Returns the matching refusal code, or null when eligible. Reads
 *  the live-source-derived record; order yields distinct, stable codes. */
function reclaimEligibility(record, policy, nowMs) {
    if (record.tier === "reclaimed")
        return "already-reclaimed";
    const terminalStates = policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"];
    if (record.derivedLifecycle !== "completed" && record.derivedLifecycle !== "failed")
        return "non-terminal";
    if (!terminalStates.includes(record.derivedLifecycle))
        return "non-terminal";
    if (record.openFeedbackCount > 0)
        return "open-feedback";
    if (!record.archived)
        return "not-archived";
    const days = policy.reclaimAfterArchiveDays ?? 0;
    if (days > 0) {
        const archivedAtMs = record.archivedAt ? Date.parse(record.archivedAt) : NaN;
        if (!Number.isFinite(archivedAtMs))
            return "within-retention";
        if (archivedAtMs > nowMs - days * 24 * 60 * 60 * 1000)
            return "within-retention";
    }
    return null;
}
/** Resolve a single run to a one-element record list via locate() (repo-first),
 *  avoiding a full-registry scan for single-run gc plan/run. */
function recordsForRunId(host, runId, scope) {
    const located = host.locate(runId, scope);
    return located ? [located.record] : [];
}
/** Dry-run: compute eligible runs, per-kind bytes that WOULD be freed, and the
 *  capability downgrade. Frees NOTHING. */
function gcPlan(host, options = {}) {
    const scope = options.scope || "home";
    const policy = reclamationPolicy(options.policy);
    const nowIso = options.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    // Fast, deterministic single-run path: resolve just that run via locate()
    // (repo-first) so a home-scope plan never re-scans the whole registry.
    const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
    const entries = [];
    let bytesToFree = 0;
    let eligibleCount = 0;
    for (const record of records) {
        const refusal = reclaimEligibility(record, policy, nowMs);
        let plan;
        try {
            const run = host.loadRun(record.repo, record.runId);
            plan = (0, reclamation_1.planReclamation)(run, { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots });
        }
        catch {
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
        const entry = {
            runId: record.runId,
            repo: record.repo,
            eligible,
            reason: eligible ? "eligible" : refusal,
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
function gcRun(host, options = {}) {
    const scope = options.scope || "home";
    const policy = reclamationPolicy(options.policy);
    const nowIso = options.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
    const maxRuns = options.limit ?? (policy.maxReclaimRuns || 0);
    const maxBytes = policy.maxReclaimBytes || 0;
    const reclaimed = [];
    const refused = [];
    let totalBytesFreed = 0;
    for (const record of records) {
        const refusal = reclaimEligibility(record, policy, nowMs);
        if (refusal) {
            refused.push({ runId: record.runId, code: refusal });
            continue;
        }
        if (maxRuns > 0 && reclaimed.length >= maxRuns)
            break;
        let run;
        try {
            run = host.loadRun(record.repo, record.runId);
        }
        catch {
            refused.push({ runId: record.runId, code: "unreadable" });
            continue;
        }
        try {
            const result = (0, reclamation_1.runReclamation)(run, {
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
            totalBytesFreed += result.bytesFreed;
            if (maxBytes > 0 && totalBytesFreed >= maxBytes)
                break;
        }
        catch (error) {
            if (error instanceof reclamation_1.ReclamationError)
                refused.push({ runId: record.runId, code: error.code });
            else
                throw error;
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
function gcVerify(host, runId, options = {}) {
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
    const result = (0, reclamation_1.verifyReclamation)(run);
    const checks = result.checks.map((c) => ({ name: c.name, pass: c.pass, code: c.code, detail: c.detail }));
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
    const verified = result.verified && eligibleWhenReclaimed;
    return {
        schemaVersion: 1,
        runId,
        reclaimed: result.reclaimed,
        verified,
        tier: located.record.tier || (result.reclaimed ? "reclaimed" : "live"),
        capability: located.record.capability || "re-runnable",
        capabilityReason: located.record.capabilityReason,
        tombstoneHash: last?.tombstoneHash,
        chainLength: result.tombstones.length,
        checks,
        nextAction: verified ? "node scripts/cw.js run show " + runId : "node scripts/cw.js gc plan"
    };
}

"use strict";
// shell/observability.ts — DERIVED metrics, ATTESTED cost. `cw metrics
// show`/`cw metrics summary`.
//
// MILESTONE 11 (reporting/observability). Byte-exact port of the old
// build's src/observability.ts — every number here is a PROJECTION of one
// run's durable state.json (timestamps -> durations, verifier nodes ->
// pass rate, candidates -> acceptance rate, failed workers/feedback ->
// failure rate). No metrics database, no collector daemon. Cost is
// ATTESTED, never fabricated: absent usage is `unreported`, never 0; a
// rate over zero samples is `n/a`, never 0%/100%.
//
// Evidence: SPEC/reporting-ux.md "cw metrics show / summary", invariant 4
// (metrics are derived and honest), invariant 5 (freshness is fail-
// closed), invariant 6 (metricsShow never touches state.json); plugins/
// cool-workflow/src/observability.ts:1-822 (byte-exact source).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMetricsSummary = exports.formatMetricsReport = exports.parseUsageFromArgs = exports.loadCostPolicy = exports.METRICS_SCHEMA_VERSION = void 0;
exports.fingerprintMetricsSource = fingerprintMetricsSource;
exports.deriveUsageTotals = deriveUsageTotals;
exports.deriveAttestationCoverage = deriveAttestationCoverage;
exports.deriveCost = deriveCost;
exports.deriveFailureRate = deriveFailureRate;
exports.deriveVerifierPassRate = deriveVerifierPassRate;
exports.deriveCandidateAcceptanceRate = deriveCandidateAcceptanceRate;
exports.deriveCollaborationMetrics = deriveCollaborationMetrics;
exports.deriveMetricsReport = deriveMetricsReport;
exports.metricsDir = metricsDir;
exports.loadPersistedMetricsFingerprint = loadPersistedMetricsFingerprint;
exports.showMetricsReport = showMetricsReport;
exports.deriveMetricsSummary = deriveMetricsSummary;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const telemetry_ledger_io_1 = require("./telemetry-ledger-io");
const collate_1 = require("../core/util/collate");
exports.METRICS_SCHEMA_VERSION = 1;
const VERIFIER_PASS_STATUSES = new Set(["verified", "completed", "committed"]);
const VERIFIER_FAIL_STATUSES = new Set(["failed", "rejected", "blocked"]);
const CANDIDATE_ACCEPTED_STATUSES = new Set(["selected", "verified"]);
function fingerprintStrings(values) {
    const { createHash } = require("node:crypto");
    const hash = createHash("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
function durationMsBetween(startedAt, endedAt) {
    if (!startedAt || !endedAt)
        return null;
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end))
        return null;
    const delta = end - start;
    return delta >= 0 ? delta : null;
}
function duration(startedAt, endedAt) {
    return { startedAt, endedAt, wallClockMs: durationMsBetween(startedAt, endedAt), inFlight: !endedAt };
}
function rate(metric, count, total, buckets) {
    if (total <= 0)
        return { metric, state: "n/a", count: null, total: 0, rate: null, buckets };
    return { metric, state: "ok", count, total, rate: round(count / total, 6), buckets };
}
function usageKey(usage) {
    if (!usage)
        return "unreported";
    return `${usage.source}:${usage.model || "-"}:${usage.inputTokens ?? "-"}:${usage.outputTokens ?? "-"}`;
}
function fingerprintMetricsSource(run) {
    const parts = [`id:${run.id}`, `createdAt:${run.createdAt}`, `updatedAt:${run.updatedAt}`, `app:${run.workflow.app?.id || run.workflow.id}`];
    for (const task of [...run.tasks].sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
        parts.push(`task:${task.id}:${task.status}:${task.dispatchedAt || "-"}:${task.completedAt || "-"}:${usageKey(task.usage)}:${task.backendId || "-"}`);
    }
    for (const worker of [...(run.workers || [])].sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
        parts.push(`worker:${worker.id}:${worker.status}:${worker.output?.recordedAt || "-"}:${usageKey(worker.usage)}:${worker.backendId || "-"}`);
    }
    for (const node of [...(run.nodes || [])].filter((n) => n.kind === "verifier").sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
        parts.push(`verifier:${node.id}:${node.status}`);
    }
    for (const cand of [...(run.candidates || [])].sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
        parts.push(`candidate:${cand.id}:${cand.status}`);
    }
    for (const fb of [...(run.feedback || [])].sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
        parts.push(`feedback:${fb.id}:${fb.status}`);
    }
    for (const m of [...(run.multiAgent?.memberships || [])].sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id))) {
        parts.push(`membership:${m.id}:${m.status}`);
    }
    return fingerprintStrings(parts);
}
function workerEndAt(worker) {
    const output = worker.output;
    if (output?.recordedAt)
        return output.recordedAt;
    if (["completed", "verified", "failed", "rejected"].includes(worker.status))
        return worker.updatedAt;
    return undefined;
}
function usageUnits(run) {
    const units = [];
    const outputTaskIds = new Set();
    for (const worker of run.workers || []) {
        if (worker.output) {
            const output = worker.output;
            outputTaskIds.add(output.taskId || worker.taskId);
            units.push({ unit: worker.id, kind: "worker", usage: worker.usage });
        }
    }
    for (const task of run.tasks) {
        if (task.status === "completed" && !outputTaskIds.has(task.id)) {
            units.push({ unit: task.id, kind: "task", usage: task.usage });
        }
    }
    return units.sort((a, b) => (0, collate_1.stableCompare)(a.unit, b.unit));
}
function tokenTotal(usage) {
    if (typeof usage.totalTokens === "number")
        return usage.totalTokens;
    return (usage.inputTokens || 0) + (usage.outputTokens || 0);
}
function deriveUsageTotals(run) {
    const units = usageUnits(run);
    const rows = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    const models = new Set();
    let attestedUnits = 0;
    for (const u of units) {
        if (!u.usage)
            continue;
        attestedUnits++;
        inputTokens += u.usage.inputTokens || 0;
        outputTokens += u.usage.outputTokens || 0;
        totalTokens += tokenTotal(u.usage);
        if (u.usage.model)
            models.add(u.usage.model);
        rows.push({ unit: u.unit, kind: u.kind, usage: u.usage });
    }
    const unitCount = units.length;
    const totals = {
        units: unitCount,
        attestedUnits,
        unreportedUnits: unitCount - attestedUnits,
        coverage: unitCount > 0 ? round(attestedUnits / unitCount, 6) : null,
        inputTokens,
        outputTokens,
        totalTokens,
        models: [...models].sort(),
    };
    return { totals, rows };
}
function deriveAttestationCoverage(run) {
    const units = usageUnits(run);
    let attested = 0;
    let unattested = 0;
    let absent = 0;
    let unverified = 0;
    for (const u of units) {
        if (!u.usage)
            continue;
        switch (u.usage.attestation) {
            case "attested":
                attested++;
                break;
            case "unattested":
                unattested++;
                break;
            case "absent":
                absent++;
                break;
            default:
                unverified++;
        }
    }
    const unitCount = units.length;
    const ledger = (0, telemetry_ledger_io_1.verifyTelemetryLedger)(run);
    return {
        units: unitCount,
        attested,
        unattested,
        absent,
        unverified,
        verifiedCoverage: unitCount > 0 ? round(attested / unitCount, 6) : null,
        ledger: { present: ledger.present, verified: ledger.verified, records: ledger.records.length },
    };
}
function priceUsage(usage, price) {
    const input = ((usage.inputTokens || 0) / 1_000_000) * price.inputPerMillion;
    const output = ((usage.outputTokens || 0) / 1_000_000) * price.outputPerMillion;
    const cacheRead = ((usage.cacheReadTokens || 0) / 1_000_000) * (price.cacheReadPerMillion || 0);
    const cacheWrite = ((usage.cacheWriteTokens || 0) / 1_000_000) * (price.cacheWritePerMillion || 0);
    return input + output + cacheRead + cacheWrite;
}
function deriveCost(rows, policy) {
    const currency = policy?.currency || "USD";
    if (rows.length === 0) {
        return { state: "unreported", currency, attestedUsd: null, estimatedUsd: null, policyId: policy?.id, unpricedModels: [], pricedCoverage: null, notes: ["No attested usage on this run; cost is unreported, not zero."] };
    }
    if (!policy) {
        return { state: "unpriced", currency, attestedUsd: null, estimatedUsd: null, unpricedModels: [], pricedCoverage: null, notes: ["Attested usage present but no pricing policy supplied; pass --pricing <path> to price it."] };
    }
    const byModel = new Map();
    for (const m of policy.models || [])
        byModel.set(m.model, m);
    let attestedUsd = 0;
    let estimatedUsd = 0;
    let pricedTokens = 0;
    let attestedTokens = 0;
    let usedDefault = false;
    let usedExact = false;
    const unpriced = new Set();
    for (const rowUsage of rows.map((r) => r.usage)) {
        const tokens = tokenTotal(rowUsage);
        attestedTokens += tokens;
        const model = rowUsage.model;
        const exact = model ? byModel.get(model) : undefined;
        const price = exact || policy.defaultPrice;
        if (!price) {
            if (model)
                unpriced.add(model);
            continue;
        }
        const cost = priceUsage(rowUsage, price);
        pricedTokens += tokens;
        if (exact) {
            attestedUsd += cost;
            usedExact = true;
        }
        else {
            estimatedUsd += cost;
            usedDefault = true;
            if (model)
                unpriced.add(model);
        }
    }
    let state;
    if (pricedTokens === 0)
        state = "unpriced";
    else if (usedDefault)
        state = "estimated";
    else if (usedExact)
        state = "attested";
    else
        state = "unpriced";
    const notes = [];
    if (usedDefault)
        notes.push("Some models lacked an exact policy entry and were priced with the policy default; that portion is `estimated`, not `attested`.");
    if (state === "unpriced")
        notes.push("Attested usage present but no policy entry (and no default) priced it; cost is unpriced.");
    return {
        state,
        currency,
        attestedUsd: usedExact ? round(attestedUsd, 6) : null,
        estimatedUsd: usedDefault ? round(estimatedUsd, 6) : null,
        policyId: policy.id,
        unpricedModels: [...unpriced].sort(),
        pricedCoverage: attestedTokens > 0 ? round(pricedTokens / attestedTokens, 6) : null,
        notes,
    };
}
function deriveFailureRate(run) {
    const workers = run.workers || [];
    const memberships = run.multiAgent?.memberships || [];
    const feedback = run.feedback || [];
    const tasks = run.tasks.filter((t) => !t.workerId && t.dispatchedAt);
    const workersFailed = workers.filter((w) => w.status === "failed" || w.status === "rejected").length;
    const tasksFailed = tasks.filter((t) => t.status === "failed").length;
    const membershipsFailed = memberships.filter((m) => m.status === "failed").length;
    const feedbackUnresolved = feedback.filter((f) => f.status === "open" || f.status === "tasked").length;
    const total = workers.length + tasks.length + memberships.length + feedback.length;
    const failures = workersFailed + tasksFailed + membershipsFailed + feedbackUnresolved;
    return rate("failure", failures, total, {
        workers: workers.length,
        workersFailed,
        tasks: tasks.length,
        tasksFailed,
        memberships: memberships.length,
        membershipsFailed,
        feedback: feedback.length,
        feedbackUnresolved,
    });
}
function deriveVerifierPassRate(run) {
    const gates = (run.nodes || []).filter((n) => n.kind === "verifier");
    const buckets = {};
    let passed = 0;
    let decided = 0;
    for (const gate of gates) {
        buckets[gate.status] = (buckets[gate.status] || 0) + 1;
        if (VERIFIER_PASS_STATUSES.has(gate.status)) {
            passed++;
            decided++;
        }
        else if (VERIFIER_FAIL_STATUSES.has(gate.status)) {
            decided++;
        }
    }
    return rate("verifier-pass", passed, decided, buckets);
}
function deriveCandidateAcceptanceRate(run) {
    const candidates = run.candidates || [];
    const buckets = {};
    let accepted = 0;
    for (const cand of candidates) {
        buckets[cand.status] = (buckets[cand.status] || 0) + 1;
        if (CANDIDATE_ACCEPTED_STATUSES.has(cand.status))
            accepted++;
    }
    return rate("candidate-acceptance", accepted, candidates.length, buckets);
}
function taskRows(run) {
    return run.tasks
        .map((task) => ({ id: task.id, kind: "task", status: task.status, duration: duration(task.dispatchedAt, task.completedAt) }))
        .sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id));
}
function workerRows(run) {
    return (run.workers || [])
        .map((worker) => ({ id: worker.id, kind: "worker", status: worker.status, duration: duration(worker.createdAt, workerEndAt(worker)) }))
        .sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id));
}
function targetCreatedAt(run, target) {
    if (target.kind === "candidate")
        return (run.candidates || []).find((e) => e.id === target.id)?.createdAt;
    if (target.kind === "commit")
        return (run.commits || []).find((e) => e.id === target.id)?.createdAt;
    if (target.kind === "selection")
        return (run.candidateSelections || []).find((e) => e.id === target.id)?.selectedAt;
    return undefined;
}
function deriveCollaborationMetrics(run) {
    const collab = run.collaboration;
    const approvalRecords = (collab?.approvals || []).filter((r) => r.decision === "approve");
    const rejectionRecords = (collab?.approvals || []).filter((r) => r.decision === "reject");
    const reviewers = new Set(approvalRecords.map((r) => r.actor?.id).filter((id) => id && id !== "unattributed"));
    const samples = [];
    for (const record of approvalRecords) {
        const createdAt = targetCreatedAt(run, record.target);
        const ms = durationMsBetween(createdAt, record.createdAt);
        if (ms !== null)
            samples.push(ms);
    }
    const meanMs = samples.length ? Math.round(samples.reduce((acc, ms) => acc + ms, 0) / samples.length) : null;
    const maxMs = samples.length ? Math.max(...samples) : null;
    return {
        approvals: approvalRecords.length,
        rejections: rejectionRecords.length,
        comments: (collab?.comments || []).length,
        handoffs: (collab?.handoffs || []).length,
        reviewers: reviewers.size,
        approvalRate: rate("approval", approvalRecords.length, approvalRecords.length + rejectionRecords.length, { approve: approvalRecords.length, reject: rejectionRecords.length }),
        timeToApproval: { samples: samples.length, meanMs, maxMs },
    };
}
function deriveMetricsReport(run, options) {
    const tasks = taskRows(run);
    const workers = workerRows(run);
    const activeTaskMs = tasks.reduce((acc, row) => acc + (row.duration.wallClockMs || 0), 0);
    const inFlight = tasks.filter((t) => t.duration.inFlight).length + workers.filter((w) => w.duration.inFlight).length;
    const pendingOrRunning = run.tasks.filter((t) => t.status === "pending" || t.status === "running").length;
    const runDuration = { startedAt: run.createdAt, endedAt: run.updatedAt, wallClockMs: durationMsBetween(run.createdAt, run.updatedAt), inFlight: pendingOrRunning > 0 };
    const { totals, rows } = deriveUsageTotals(run);
    const cost = deriveCost(rows, options.policy);
    const currentFingerprint = fingerprintMetricsSource(run);
    let status;
    if (!options.persistedFingerprint)
        status = "absent";
    else if (options.persistedFingerprint === currentFingerprint)
        status = "valid";
    else
        status = "stale";
    const backendIds = new Set();
    for (const task of run.tasks)
        if (task.backendId)
            backendIds.add(task.backendId);
    for (const worker of run.workers || [])
        if (worker.backendId)
            backendIds.add(worker.backendId);
    return {
        schemaVersion: exports.METRICS_SCHEMA_VERSION,
        surface: "metrics",
        runId: run.id,
        generatedAt: options.now,
        sourceFingerprint: currentFingerprint,
        freshness: { status, persistedFingerprint: options.persistedFingerprint, currentFingerprint },
        scope: { app: run.workflow.app?.id || run.workflow.id, backendIds: [...backendIds].sort() },
        time: { run: runDuration, activeTaskMs, inFlight, tasks, workers },
        rates: { failure: deriveFailureRate(run), verifierPass: deriveVerifierPassRate(run), candidateAcceptance: deriveCandidateAcceptanceRate(run) },
        usage: totals,
        cost,
        attestedUsage: rows,
        attestation: deriveAttestationCoverage(run),
        collaboration: deriveCollaborationMetrics(run),
        nextAction: totals.unreportedUnits > 0 && totals.attestedUnits === 0
            ? "No attested usage yet — record host usage on result/worker intake (cw result ... --usage-input-tokens N --usage-output-tokens M --usage-model ID)."
            : `cw metrics show ${run.id} --json`,
    };
}
function metricsDir(run) {
    return path.join(run.paths.runDir, "metrics");
}
function metricsReportPath(run) {
    return path.join(metricsDir(run), "metrics-report.json");
}
function loadPersistedMetricsFingerprint(run) {
    const file = metricsReportPath(run);
    if (!fs.existsSync(file))
        return undefined;
    try {
        return (0, fs_atomic_1.readJson)(file).sourceFingerprint;
    }
    catch {
        return undefined;
    }
}
/** Derive + persist the per-run report. The RETURNED payload is pinned to
 *  `freshness: "valid"` (persistedFingerprint === itself) so `cw metrics
 *  show --json` and the MCP tool are byte-identical. The Workbench's private
 *  projection mode keeps that established payload but does not create a
 *  derived file; NEVER touches state.json (invariant 6). */
function showMetricsReport(run, options) {
    const live = deriveMetricsReport(run, { now: options.now, policy: options.policy });
    const report = { ...live, freshness: { status: "valid", persistedFingerprint: live.sourceFingerprint, currentFingerprint: live.sourceFingerprint } };
    if (options.persist !== false) {
        fs.mkdirSync(metricsDir(run), { recursive: true });
        (0, fs_atomic_1.writeJson)(metricsReportPath(run), report);
    }
    return report;
}
function poolRates(metric, rates) {
    let count = 0;
    let total = 0;
    const buckets = {};
    for (const r of rates) {
        total += r.total;
        count += r.count || 0;
        for (const [k, v] of Object.entries(r.buckets || {}))
            buckets[k] = (buckets[k] || 0) + v;
    }
    return rate(metric, count, total, buckets);
}
function poolUsage(list) {
    let units = 0;
    let attestedUnits = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    const models = new Set();
    for (const u of list) {
        units += u.units;
        attestedUnits += u.attestedUnits;
        inputTokens += u.inputTokens;
        outputTokens += u.outputTokens;
        totalTokens += u.totalTokens;
        for (const m of u.models)
            models.add(m);
    }
    return { units, attestedUnits, unreportedUnits: units - attestedUnits, coverage: units > 0 ? round(attestedUnits / units, 6) : null, inputTokens, outputTokens, totalTokens, models: [...models].sort() };
}
function poolCost(list) {
    const currency = list.find((c) => c.currency)?.currency || "USD";
    let attestedUsd = null;
    let estimatedUsd = null;
    const unpriced = new Set();
    let anyAttested = false;
    let anyEstimated = false;
    let anyUnpriced = false;
    let anyReported = false;
    let policyId;
    for (const c of list) {
        if (c.attestedUsd !== null) {
            attestedUsd = round((attestedUsd || 0) + c.attestedUsd, 6);
            anyAttested = true;
        }
        if (c.estimatedUsd !== null) {
            estimatedUsd = round((estimatedUsd || 0) + c.estimatedUsd, 6);
            anyEstimated = true;
        }
        for (const m of c.unpricedModels)
            unpriced.add(m);
        if (c.state === "unpriced")
            anyUnpriced = true;
        if (c.state !== "unreported")
            anyReported = true;
        if (c.policyId)
            policyId = c.policyId;
    }
    let state;
    if (!anyReported)
        state = "unreported";
    else if (anyEstimated)
        state = "estimated";
    else if (anyAttested)
        state = "attested";
    else if (anyUnpriced)
        state = "unpriced";
    else
        state = "unreported";
    const notes = [];
    if (anyAttested && anyEstimated)
        notes.push("Totals mix exact-priced (attested) and default-priced (estimated) runs; the two USD figures are kept separate.");
    return { state, currency, attestedUsd, estimatedUsd, policyId, unpricedModels: [...unpriced].sort(), pricedCoverage: null, notes };
}
function deriveMetricsSummary(inputs, options) {
    const perRun = [];
    for (const input of inputs) {
        const report = deriveMetricsReport(input.run, { now: options.now, policy: options.policy, persistedFingerprint: input.persistedFingerprint });
        perRun.push({ report, ref: { runId: report.runId, repo: input.repo, app: report.scope.app, backendIds: report.scope.backendIds, freshness: report.freshness.status, rates: report.rates, usage: report.usage, cost: report.cost } });
    }
    perRun.sort((a, b) => (0, collate_1.stableCompare)(a.report.runId, b.report.runId));
    const groupBy = (keyOf) => {
        const map = new Map();
        for (const { report } of perRun) {
            for (const key of keyOf(report)) {
                const list = map.get(key) || [];
                list.push(report);
                map.set(key, list);
            }
        }
        return [...map.entries()]
            .sort((a, b) => (0, collate_1.stableCompare)(a[0], b[0]))
            .map(([key, reports]) => ({
            key,
            runCount: reports.length,
            rates: { failure: poolRates("failure", reports.map((r) => r.rates.failure)), verifierPass: poolRates("verifier-pass", reports.map((r) => r.rates.verifierPass)), candidateAcceptance: poolRates("candidate-acceptance", reports.map((r) => r.rates.candidateAcceptance)) },
            usage: poolUsage(reports.map((r) => r.usage)),
            cost: poolCost(reports.map((r) => r.cost)),
        }));
    };
    const allReports = perRun.map((p) => p.report);
    const totalOutputBytes = inputs.reduce((sum, input) => sum + (input.run.workers || []).reduce((ws, w) => ws + (w.outputSizeBytes || 0), 0), 0);
    const computePerBackendCost = (inputList) => {
        const map = new Map();
        for (const input of inputList) {
            const backends = new Set((input.run.workers || []).map((w) => w.backendId || "node"));
            const bytes = (input.run.workers || []).reduce((s, w) => s + (w.outputSizeBytes || 0), 0);
            for (const bid of backends) {
                const entry = map.get(bid) || { runCount: 0, outputBytes: 0 };
                entry.runCount++;
                entry.outputBytes += bytes;
                map.set(bid, entry);
            }
        }
        return [...map.entries()].map(([backendId, data]) => ({ backendId, ...data }));
    };
    return {
        schemaVersion: exports.METRICS_SCHEMA_VERSION,
        surface: "metrics",
        scope: options.scope,
        generatedAt: options.now,
        runCount: perRun.length,
        unreadableRuns: options.unreadableRuns || 0,
        rates: { failure: poolRates("failure", allReports.map((r) => r.rates.failure)), verifierPass: poolRates("verifier-pass", allReports.map((r) => r.rates.verifierPass)), candidateAcceptance: poolRates("candidate-acceptance", allReports.map((r) => r.rates.candidateAcceptance)) },
        usage: poolUsage(allReports.map((r) => r.usage)),
        cost: poolCost(allReports.map((r) => r.cost)),
        totalOutputBytes,
        byBackendCost: computePerBackendCost(inputs),
        byApp: groupBy((r) => [r.scope.app || "unknown"]),
        byBackend: groupBy((r) => (r.scope.backendIds.length ? r.scope.backendIds : ["unreported"])),
        runs: perRun.map((p) => p.ref),
        nextAction: perRun.length === 0 ? "No indexed runs; run a workflow, then `cw metrics summary`." : "Per-run detail: cw metrics show <run-id> --json",
    };
}
var observability_intake_1 = require("./observability-intake");
Object.defineProperty(exports, "loadCostPolicy", { enumerable: true, get: function () { return observability_intake_1.loadCostPolicy; } });
Object.defineProperty(exports, "parseUsageFromArgs", { enumerable: true, get: function () { return observability_intake_1.parseUsageFromArgs; } });
var observability_format_1 = require("./observability-format");
Object.defineProperty(exports, "formatMetricsReport", { enumerable: true, get: function () { return observability_format_1.formatMetricsReport; } });
Object.defineProperty(exports, "formatMetricsSummary", { enumerable: true, get: function () { return observability_format_1.formatMetricsSummary; } });

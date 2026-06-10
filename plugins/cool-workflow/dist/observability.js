"use strict";
// Observability + Cost Accounting (v0.1.31) — DERIVED metrics, ATTESTED cost.
//
// BSD / Unix discipline (each non-trivial choice cites its tenet):
//
//  - DERIVED, NOT A TELEMETRY PIPELINE. Every number here is a PROJECTION of one
//    run's durable `.cw/runs/<id>/state.json`: timestamps → durations, verifier
//    nodes → pass rate, candidates → acceptance rate, failed workers/feedback →
//    failure rate. No metrics database, no collector daemon, no hidden counter.
//    deriveMetricsReport() is a PURE function of (run, now, policy) and NEVER
//    mutates source records.
//
//  - COST IS ATTESTED, NEVER MEASURED OR FABRICATED. CW does not call the model;
//    the host/worker does. Token usage is read from the host-attested UsageRecord
//    on the task/worker record. Absent usage is `unreported` — never 0. Cost is
//    `attested` only when attested usage is priced by an EXACT policy match;
//    assumed pricing is a separate `estimated` figure; the two never conflate.
//
//  - MECHANISM VS POLICY. This module is MECHANISM. The pricing table is POLICY,
//    supplied as DATA (CostPolicy) and kept out of the kernel: the same attested
//    usage yields different cost under different policies without touching code.
//
//  - A COUNTER YOU CANNOT TRUST IS WORSE THAN NONE. A rate over zero samples is
//    `n/a`, never 0%/100%. Every RateMetric carries count + total + buckets.
//
//  - DETERMINISTIC & REPLAYABLE. Wall-clock "now" is INJECTED (the only
//    now-derived field is `generatedAt`); all durations come from recorded
//    timestamps. A report over a fixed snapshot is byte-reproducible.
//
//  - FAIL CLOSED ON DRIFT. A fingerprinted, rebuildable per-run snapshot reports
//    `valid|stale|absent` against current source — same ethos as the v0.1.25
//    state-explosion summaries and the v0.1.28 registry.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.METRICS_SCHEMA_VERSION = void 0;
exports.fingerprintMetricsSource = fingerprintMetricsSource;
exports.deriveUsageTotals = deriveUsageTotals;
exports.deriveCost = deriveCost;
exports.deriveFailureRate = deriveFailureRate;
exports.deriveVerifierPassRate = deriveVerifierPassRate;
exports.deriveCandidateAcceptanceRate = deriveCandidateAcceptanceRate;
exports.deriveMetricsReport = deriveMetricsReport;
exports.deriveCollaborationMetrics = deriveCollaborationMetrics;
exports.metricsDir = metricsDir;
exports.loadPersistedMetricsFingerprint = loadPersistedMetricsFingerprint;
exports.loadPersistedMetricsReport = loadPersistedMetricsReport;
exports.showMetricsReport = showMetricsReport;
exports.deriveMetricsSummary = deriveMetricsSummary;
exports.loadCostPolicy = loadCostPolicy;
exports.parseUsageFromArgs = parseUsageFromArgs;
exports.formatMetricsReport = formatMetricsReport;
exports.formatMetricsSummary = formatMetricsSummary;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
exports.METRICS_SCHEMA_VERSION = 1;
// Verifier-gate decision classes (derived, never invented).
const VERIFIER_PASS_STATUSES = new Set(["verified", "completed", "committed"]);
const VERIFIER_FAIL_STATUSES = new Set(["failed", "rejected", "blocked"]);
// Candidate acceptance classes.
const CANDIDATE_ACCEPTED_STATUSES = new Set(["selected", "verified"]);
// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------
function fingerprintStrings(values) {
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
/** Round to a fixed precision deterministically (no locale, no float drift in
 *  the serialized form). */
function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
/** ms between two ISO timestamps, or null if either is missing/unparseable or
 *  the result would be negative (clock skew ⇒ untrustworthy ⇒ null, not a lie). */
function durationMs(startedAt, endedAt) {
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
    const wallClockMs = durationMs(startedAt, endedAt);
    return {
        startedAt,
        endedAt,
        wallClockMs,
        inFlight: !endedAt
    };
}
/** Build a fail-closed rate. total === 0 ⇒ `n/a` (count/rate null). */
function rate(metric, count, total, buckets) {
    if (total <= 0) {
        return { metric, state: "n/a", count: null, total: 0, rate: null, buckets };
    }
    return { metric, state: "ok", count, total, rate: round(count / total, 6), buckets };
}
// ---------------------------------------------------------------------------
// Source fingerprint (structural, not mtime — a tampered status trips `stale`).
// ---------------------------------------------------------------------------
function fingerprintMetricsSource(run) {
    const parts = [
        `id:${run.id}`,
        `createdAt:${run.createdAt}`,
        `updatedAt:${run.updatedAt}`,
        `app:${run.workflow.app?.id || run.workflow.id}`
    ];
    for (const task of [...(run.tasks || [])].sort((a, b) => a.id.localeCompare(b.id))) {
        parts.push(`task:${task.id}:${task.status}:${task.dispatchedAt || "-"}:${task.completedAt || "-"}:${usageKey(task.usage)}:${task.backendId || "-"}`);
    }
    for (const worker of [...(run.workers || [])].sort((a, b) => a.id.localeCompare(b.id))) {
        parts.push(`worker:${worker.id}:${worker.status}:${worker.output?.recordedAt || "-"}:${usageKey(worker.usage)}:${worker.backendId || "-"}`);
    }
    for (const node of [...(run.nodes || [])].filter((n) => n.kind === "verifier").sort((a, b) => a.id.localeCompare(b.id))) {
        parts.push(`verifier:${node.id}:${node.status}`);
    }
    for (const cand of [...(run.candidates || [])].sort((a, b) => a.id.localeCompare(b.id))) {
        parts.push(`candidate:${cand.id}:${cand.status}`);
    }
    for (const fb of [...(run.feedback || [])].sort((a, b) => a.id.localeCompare(b.id))) {
        parts.push(`feedback:${fb.id}:${fb.status}`);
    }
    for (const m of [...(run.multiAgent?.memberships || [])].sort((a, b) => a.id.localeCompare(b.id))) {
        parts.push(`membership:${m.id}:${m.status}`);
    }
    return fingerprintStrings(parts);
}
function usageKey(usage) {
    if (!usage)
        return "unreported";
    return `${usage.source}:${usage.model || "-"}:${usage.inputTokens ?? "-"}:${usage.outputTokens ?? "-"}`;
}
// ---------------------------------------------------------------------------
// Worker / unit helpers
// ---------------------------------------------------------------------------
/** A worker's recorded end timestamp, or undefined when still in-flight. */
function workerEndAt(worker) {
    if (worker.output?.recordedAt)
        return worker.output.recordedAt;
    if (["completed", "verified", "failed", "rejected"].includes(worker.status))
        return worker.updatedAt;
    return undefined;
}
// ---------------------------------------------------------------------------
// Usage + cost
// ---------------------------------------------------------------------------
/** The work units that COULD carry attested usage: every worker that produced
 *  output, plus every completed task NOT already represented by such a worker (a
 *  worker-output-backed task's usage rides on the worker, so it is never
 *  double-counted; a task completed directly via `cw result` is its own unit
 *  even if a worker was allocated but never recorded output). */
function usageUnits(run) {
    const units = [];
    const outputTaskIds = new Set();
    for (const worker of run.workers || []) {
        if (worker.output) {
            outputTaskIds.add(worker.output.taskId || worker.taskId);
            units.push({ unit: worker.id, kind: "worker", usage: worker.usage });
        }
    }
    for (const task of run.tasks || []) {
        if (task.status === "completed" && !outputTaskIds.has(task.id)) {
            units.push({ unit: task.id, kind: "task", usage: task.usage });
        }
    }
    return units.sort((a, b) => a.unit.localeCompare(b.unit));
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
        models: [...models].sort()
    };
    return { totals, rows };
}
/** Compute cost from attested usage × an optional pricing policy. The contract:
 *  attested = exact-match priced; estimated = default/fallback priced; unpriced =
 *  attested usage with no policy coverage; unreported = no attested usage. */
function deriveCost(rows, policy) {
    const currency = policy?.currency || "USD";
    if (rows.length === 0) {
        return {
            state: "unreported",
            currency,
            attestedUsd: null,
            estimatedUsd: null,
            policyId: policy?.id,
            unpricedModels: [],
            pricedCoverage: null,
            notes: ["No attested usage on this run; cost is unreported, not zero."]
        };
    }
    if (!policy) {
        return {
            state: "unpriced",
            currency,
            attestedUsd: null,
            estimatedUsd: null,
            unpricedModels: [],
            pricedCoverage: null,
            notes: ["Attested usage present but no pricing policy supplied; pass --pricing <path> to price it."]
        };
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
    for (const row of rows) {
        const usage = row.usage;
        const tokens = tokenTotal(usage);
        attestedTokens += tokens;
        const model = usage.model;
        const exact = model ? byModel.get(model) : undefined;
        const price = exact || policy.defaultPrice;
        if (!price) {
            if (model)
                unpriced.add(model);
            continue; // attested usage we cannot price under this policy
        }
        const cost = priceUsage(usage, price);
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
        notes
    };
}
function priceUsage(usage, price) {
    const input = ((usage.inputTokens || 0) / 1_000_000) * price.inputPerMillion;
    const output = ((usage.outputTokens || 0) / 1_000_000) * price.outputPerMillion;
    const cacheRead = ((usage.cacheReadTokens || 0) / 1_000_000) * (price.cacheReadPerMillion || 0);
    const cacheWrite = ((usage.cacheWriteTokens || 0) / 1_000_000) * (price.cacheWritePerMillion || 0);
    return input + output + cacheRead + cacheWrite;
}
// ---------------------------------------------------------------------------
// Rates (each a fail-closed RateMetric with explicit sample counts)
// ---------------------------------------------------------------------------
function deriveFailureRate(run) {
    const workers = run.workers || [];
    const memberships = run.multiAgent?.memberships || [];
    const feedback = run.feedback || [];
    // Tasks not backed by a worker (a worker-backed task's outcome rides on its
    // worker), counted only when dispatched (an attempt actually happened).
    const tasks = (run.tasks || []).filter((t) => !t.workerId && t.dispatchedAt);
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
        feedbackUnresolved
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
        // pending/running gates are undecided ⇒ excluded from the denominator.
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
// ---------------------------------------------------------------------------
// Time / duration
// ---------------------------------------------------------------------------
function taskRows(run) {
    return (run.tasks || [])
        .map((task) => ({
        id: task.id,
        kind: "task",
        status: task.status,
        duration: duration(task.dispatchedAt, task.completedAt)
    }))
        .sort((a, b) => a.id.localeCompare(b.id));
}
function workerRows(run) {
    return (run.workers || [])
        .map((worker) => ({
        id: worker.id,
        kind: "worker",
        status: worker.status,
        duration: duration(worker.createdAt, workerEndAt(worker))
    }))
        .sort((a, b) => a.id.localeCompare(b.id));
}
function deriveMetricsReport(run, options) {
    const tasks = taskRows(run);
    const workers = workerRows(run);
    const activeTaskMs = tasks.reduce((acc, row) => acc + (row.duration.wallClockMs || 0), 0);
    const inFlight = tasks.filter((t) => t.duration.inFlight).length + workers.filter((w) => w.duration.inFlight).length;
    const pendingOrRunning = (run.tasks || []).filter((t) => t.status === "pending" || t.status === "running").length;
    const runDuration = {
        startedAt: run.createdAt,
        endedAt: run.updatedAt,
        wallClockMs: durationMs(run.createdAt, run.updatedAt),
        inFlight: pendingOrRunning > 0
    };
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
    for (const task of run.tasks || [])
        if (task.backendId)
            backendIds.add(task.backendId);
    for (const worker of run.workers || [])
        if (worker.backendId)
            backendIds.add(worker.backendId);
    const report = {
        schemaVersion: exports.METRICS_SCHEMA_VERSION,
        surface: "metrics",
        runId: run.id,
        generatedAt: options.now,
        sourceFingerprint: currentFingerprint,
        freshness: {
            status,
            persistedFingerprint: options.persistedFingerprint,
            currentFingerprint
        },
        scope: {
            app: run.workflow.app?.id || run.workflow.id,
            backendIds: [...backendIds].sort()
        },
        time: {
            run: runDuration,
            activeTaskMs,
            inFlight,
            tasks,
            workers
        },
        rates: {
            failure: deriveFailureRate(run),
            verifierPass: deriveVerifierPassRate(run),
            candidateAcceptance: deriveCandidateAcceptanceRate(run)
        },
        usage: totals,
        cost,
        attestedUsage: rows,
        collaboration: deriveCollaborationMetrics(run),
        nextAction: totals.unreportedUnits > 0 && totals.attestedUnits === 0
            ? "No attested usage yet — record host usage on result/worker intake (cw result ... --usage-input-tokens N --usage-output-tokens M --usage-model ID)."
            : `node scripts/cw.js metrics show ${run.id} --json`
    };
    return report;
}
/** v0.1.32 collaboration metrics — counts, approval rate, and time-to-approval,
 *  all from append-only records + recorded timestamps. The ONLY now-derived
 *  field anywhere in the report remains `generatedAt`; these are byte-stable. */
function deriveCollaborationMetrics(run) {
    const collab = run.collaboration;
    const approvalRecords = (collab?.approvals || []).filter((record) => record.decision === "approve");
    const rejectionRecords = (collab?.approvals || []).filter((record) => record.decision === "reject");
    const reviewers = new Set(approvalRecords.map((record) => record.actor?.id).filter((id) => id && id !== "unattributed"));
    const samples = [];
    for (const record of approvalRecords) {
        const createdAt = targetCreatedAt(run, record.target);
        const ms = durationMs(createdAt, record.createdAt);
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
        approvalRate: rate("approval", approvalRecords.length, approvalRecords.length + rejectionRecords.length, {
            approve: approvalRecords.length,
            reject: rejectionRecords.length
        }),
        timeToApproval: { samples: samples.length, meanMs, maxMs }
    };
}
/** Recorded creation timestamp of an approval's target (for time-to-approval). */
function targetCreatedAt(run, target) {
    if (target.kind === "candidate")
        return (run.candidates || []).find((entry) => entry.id === target.id)?.createdAt;
    if (target.kind === "commit")
        return (run.commits || []).find((entry) => entry.id === target.id)?.createdAt;
    if (target.kind === "selection")
        return (run.candidateSelections || []).find((entry) => entry.id === target.id)?.selectedAt;
    return undefined;
}
// ---------------------------------------------------------------------------
// Persistence — a rebuildable, fingerprinted snapshot (fail-closed freshness).
// ---------------------------------------------------------------------------
function metricsDir(run) {
    return node_path_1.default.join(run.paths.runDir, "metrics");
}
function metricsReportPath(run) {
    return node_path_1.default.join(metricsDir(run), "metrics-report.json");
}
/** Read the persisted source fingerprint for this run, if any (never throws). */
function loadPersistedMetricsFingerprint(run) {
    const file = metricsReportPath(run);
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    try {
        const parsed = (0, state_1.readJson)(file);
        return parsed.sourceFingerprint;
    }
    catch {
        return undefined;
    }
}
/** Read the full persisted per-run report, if any (never throws). */
function loadPersistedMetricsReport(run) {
    const file = metricsReportPath(run);
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    try {
        return (0, state_1.readJson)(file);
    }
    catch {
        return undefined;
    }
}
/** Derive + persist the per-run report. The RETURNED payload is order- and
 *  cache-independent (freshness === "valid", persistedFingerprint === itself),
 *  so `cw metrics show --json` and `cw_metrics_show` are byte-identical. The
 *  persisted file is what the cross-repo summary + Workbench read back. */
function showMetricsReport(run, options) {
    const live = deriveMetricsReport(run, { now: options.now, policy: options.policy });
    const report = {
        ...live,
        freshness: {
            status: "valid",
            persistedFingerprint: live.sourceFingerprint,
            currentFingerprint: live.sourceFingerprint
        }
    };
    node_fs_1.default.mkdirSync(metricsDir(run), { recursive: true });
    (0, state_1.writeJson)(metricsReportPath(run), report);
    return report;
}
// ---------------------------------------------------------------------------
// Cross-repo rollup (pool samples; sum attested usage/cost with coverage).
// ---------------------------------------------------------------------------
/** Pool a list of RateMetrics into one (insufficient-data when no samples). */
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
/** Sum a list of UsageTotals (coverage recomputed over pooled units). */
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
    return {
        units,
        attestedUnits,
        unreportedUnits: units - attestedUnits,
        coverage: units > 0 ? round(attestedUnits / units, 6) : null,
        inputTokens,
        outputTokens,
        totalTokens,
        models: [...models].sort()
    };
}
/** Sum a list of CostMetrics (attested + estimated kept separate; states merge
 *  conservatively so attested+estimated never collapses into one figure). */
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
    return {
        state,
        currency,
        attestedUsd,
        estimatedUsd,
        policyId,
        unpricedModels: [...unpriced].sort(),
        pricedCoverage: null,
        notes
    };
}
/** Build the cross-repo rollup from already-loaded runs. PURE over its inputs +
 *  injected `now`. `unreadableRuns` counts runs whose source could not be loaded
 *  (the caller passes the count); they are surfaced, never silently dropped. */
function deriveMetricsSummary(inputs, options) {
    const perRun = [];
    for (const input of inputs) {
        const report = deriveMetricsReport(input.run, {
            now: options.now,
            policy: options.policy,
            persistedFingerprint: input.persistedFingerprint
        });
        perRun.push({
            report,
            ref: {
                runId: report.runId,
                repo: input.repo,
                app: report.scope.app,
                backendIds: report.scope.backendIds,
                freshness: report.freshness.status,
                rates: report.rates,
                usage: report.usage,
                cost: report.cost
            }
        });
    }
    perRun.sort((a, b) => a.report.runId.localeCompare(b.report.runId));
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
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, reports]) => ({
            key,
            runCount: reports.length,
            rates: {
                failure: poolRates("failure", reports.map((r) => r.rates.failure)),
                verifierPass: poolRates("verifier-pass", reports.map((r) => r.rates.verifierPass)),
                candidateAcceptance: poolRates("candidate-acceptance", reports.map((r) => r.rates.candidateAcceptance))
            },
            usage: poolUsage(reports.map((r) => r.usage)),
            cost: poolCost(reports.map((r) => r.cost))
        }));
    };
    const allReports = perRun.map((p) => p.report);
    const totalOutputBytes = inputs.reduce((sum, input) => sum + (input.run.workers || []).reduce((ws, w) => ws + (w.outputSizeBytes || 0), 0), 0);
    return {
        schemaVersion: exports.METRICS_SCHEMA_VERSION,
        surface: "metrics",
        scope: options.scope,
        generatedAt: options.now,
        runCount: perRun.length,
        unreadableRuns: options.unreadableRuns || 0,
        rates: {
            failure: poolRates("failure", allReports.map((r) => r.rates.failure)),
            verifierPass: poolRates("verifier-pass", allReports.map((r) => r.rates.verifierPass)),
            candidateAcceptance: poolRates("candidate-acceptance", allReports.map((r) => r.rates.candidateAcceptance))
        },
        usage: poolUsage(allReports.map((r) => r.usage)),
        cost: poolCost(allReports.map((r) => r.cost)),
        totalOutputBytes,
        byApp: groupBy((r) => [r.scope.app || "unknown"]),
        byBackend: groupBy((r) => (r.scope.backendIds.length ? r.scope.backendIds : ["unreported"])),
        runs: perRun.map((p) => p.ref),
        nextAction: perRun.length === 0 ? "No indexed runs; run a workflow, then `cw metrics summary`." : "Per-run detail: cw metrics show <run-id> --json"
    };
}
// ---------------------------------------------------------------------------
// Pricing policy loader (POLICY as DATA — kept out of the kernel).
// ---------------------------------------------------------------------------
/** Resolve a CostPolicy from CLI/MCP args. `--pricing <path>` loads a policy
 *  file; `--pricing default|bundled` loads the bundled example under
 *  manifest/pricing.policy.json. Absent ⇒ undefined ⇒ cost is `unpriced`/
 *  `unreported`, never guessed. */
function loadCostPolicy(args, pluginRoot) {
    const raw = args.pricing ?? args.pricingPolicy ?? args.policy;
    if (raw === undefined || raw === null || raw === "")
        return undefined;
    const value = String(raw);
    const file = value === "default" || value === "bundled"
        ? node_path_1.default.join(pluginRoot, "manifest", "pricing.policy.json")
        : node_path_1.default.resolve(value);
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`Pricing policy file not found: ${file}`);
    const parsed = (0, state_1.readJson)(file);
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.models)) {
        throw new Error(`Invalid pricing policy (expected schemaVersion 1 + models[]): ${file}`);
    }
    return parsed;
}
/** Parse a host-attested UsageRecord from CLI/MCP intake args. Returns undefined
 *  when NO usage was provided (⇒ `unreported`). CW never fabricates usage, so a
 *  caller that passes nothing gets nothing. */
function parseUsageFromArgs(args, now) {
    const inline = args.usage;
    if (inline && typeof inline === "object" && !Array.isArray(inline)) {
        return normalizeUsage(inline, now);
    }
    const input = numeric(args.usageInputTokens ?? args["usage-input-tokens"]);
    const output = numeric(args.usageOutputTokens ?? args["usage-output-tokens"]);
    const model = args.usageModel ?? args["usage-model"];
    const total = numeric(args.usageTotalTokens ?? args["usage-total-tokens"]);
    const cacheRead = numeric(args.usageCacheReadTokens ?? args["usage-cache-read-tokens"]);
    const cacheWrite = numeric(args.usageCacheWriteTokens ?? args["usage-cache-write-tokens"]);
    if (input === undefined && output === undefined && total === undefined && model === undefined) {
        return undefined;
    }
    return normalizeUsage({
        source: args.usageSource ?? args["usage-source"],
        model,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        attestedAt: args.usageAttestedAt ?? args["usage-attested-at"],
        note: args.usageNote ?? args["usage-note"]
    }, now);
}
function normalizeUsage(raw, now) {
    const source = raw.source === "operator-recorded" ? "operator-recorded" : "host-attested";
    const usage = {
        schemaVersion: 1,
        source,
        attestedAt: typeof raw.attestedAt === "string" && raw.attestedAt ? raw.attestedAt : now
    };
    if (raw.model !== undefined && raw.model !== null && raw.model !== "")
        usage.model = String(raw.model);
    const input = numeric(raw.inputTokens);
    const output = numeric(raw.outputTokens);
    const total = numeric(raw.totalTokens);
    const cacheRead = numeric(raw.cacheReadTokens);
    const cacheWrite = numeric(raw.cacheWriteTokens);
    if (input !== undefined)
        usage.inputTokens = input;
    if (output !== undefined)
        usage.outputTokens = output;
    if (total !== undefined)
        usage.totalTokens = total;
    if (cacheRead !== undefined)
        usage.cacheReadTokens = cacheRead;
    if (cacheWrite !== undefined)
        usage.cacheWriteTokens = cacheWrite;
    if (raw.note !== undefined && raw.note !== null && raw.note !== "")
        usage.note = String(raw.note);
    return usage;
}
function numeric(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
// ---------------------------------------------------------------------------
// Human formatters (CLI default text; --json emits the canonical payload).
// ---------------------------------------------------------------------------
function formatRate(r) {
    if (r.state === "n/a")
        return `n/a (0 samples)`;
    return `${((r.rate * 100)).toFixed(1)}% (${r.count}/${r.total})`;
}
function formatMs(ms) {
    if (ms === null)
        return "—";
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
function formatCost(c) {
    const parts = [`state=${c.state}`];
    if (c.attestedUsd !== null)
        parts.push(`attested=${c.currency} ${c.attestedUsd}`);
    if (c.estimatedUsd !== null)
        parts.push(`estimated=${c.currency} ${c.estimatedUsd}`);
    if (c.unpricedModels.length)
        parts.push(`unpriced-models=${c.unpricedModels.join(",")}`);
    return parts.join("  ");
}
function formatMetricsReport(report) {
    const lines = [];
    lines.push(`metrics ${report.runId}  [${report.freshness.status}]  app=${report.scope.app || "-"}`);
    lines.push(`  time: run=${formatMs(report.time.run.wallClockMs)}${report.time.run.inFlight ? " (in-flight)" : ""}  active-task=${formatMs(report.time.activeTaskMs)}  in-flight-items=${report.time.inFlight}`);
    lines.push(`  failure-rate:    ${formatRate(report.rates.failure)}`);
    lines.push(`  verifier-pass:   ${formatRate(report.rates.verifierPass)}`);
    lines.push(`  cand-acceptance: ${formatRate(report.rates.candidateAcceptance)}`);
    const collab = report.collaboration;
    lines.push(`  collaboration:   approvals=${collab.approvals} rejections=${collab.rejections} comments=${collab.comments} handoffs=${collab.handoffs} reviewers=${collab.reviewers}  approval-rate=${formatRate(collab.approvalRate)}  time-to-approval=${collab.timeToApproval.meanMs === null ? "n/a" : `${Math.round(collab.timeToApproval.meanMs / 1000)}s`} (${collab.timeToApproval.samples} samples)`);
    const cov = report.usage.coverage === null ? "n/a" : `${(report.usage.coverage * 100).toFixed(0)}%`;
    lines.push(`  usage: attested=${report.usage.attestedUnits}/${report.usage.units} units (coverage ${cov}), unreported=${report.usage.unreportedUnits}; tokens in=${report.usage.inputTokens} out=${report.usage.outputTokens} total=${report.usage.totalTokens}`);
    lines.push(`  cost:  ${formatCost(report.cost)}`);
    if (report.usage.models.length)
        lines.push(`  models: ${report.usage.models.join(", ")}`);
    lines.push(`  next: ${report.nextAction}`);
    return lines.join("\n");
}
function formatMetricsSummary(summary) {
    const lines = [];
    lines.push(`metrics summary  scope=${summary.scope}  runs=${summary.runCount}${summary.unreadableRuns ? ` (+${summary.unreadableRuns} unreadable)` : ""}`);
    lines.push(`  failure-rate:    ${formatRate(summary.rates.failure)}`);
    lines.push(`  verifier-pass:   ${formatRate(summary.rates.verifierPass)}`);
    lines.push(`  cand-acceptance: ${formatRate(summary.rates.candidateAcceptance)}`);
    const cov = summary.usage.coverage === null ? "n/a" : `${(summary.usage.coverage * 100).toFixed(0)}%`;
    lines.push(`  usage: attested=${summary.usage.attestedUnits}/${summary.usage.units} units (coverage ${cov}); tokens total=${summary.usage.totalTokens}`);
    lines.push(`  cost:  ${formatCost(summary.cost)}`);
    for (const app of summary.byApp) {
        lines.push(`  app ${app.key}: runs=${app.runCount} verifier=${formatRate(app.rates.verifierPass)} cost=${formatCost(app.cost)}`);
    }
    for (const backend of summary.byBackend) {
        lines.push(`  backend ${backend.key}: runs=${backend.runCount} failure=${formatRate(backend.rates.failure)}`);
    }
    lines.push(`  next: ${summary.nextAction}`);
    return lines.join("\n");
}

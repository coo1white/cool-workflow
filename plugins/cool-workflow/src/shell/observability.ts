// shell/observability.ts — DERIVED metrics, ATTESTED cost. `cw metrics
// show`/`cw metrics summary`.
//
// MILESTONE 11 (reporting/observability). Byte-exact port of the old
// build's observability module — every number here is a PROJECTION of one
// run's durable state.json (timestamps -> durations, verifier nodes ->
// pass rate, candidates -> acceptance rate, failed workers/feedback ->
// failure rate). No metrics database, no collector daemon. Cost is
// ATTESTED, never fabricated: absent usage is `unreported`, never 0; a
// rate over zero samples is `n/a`, never 0%/100%.
//
// Evidence: SPEC/reporting-ux.md "cw metrics show / summary", invariant 4
// (metrics are derived and honest), invariant 5 (freshness is fail-
// closed), invariant 6 (metricsShow never touches state.json).

import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJson } from "./fs-atomic";
import { WorkflowRun, RunTask } from "../core/state/types";
import { WorkerScope } from "./worker-isolation";
import { verifyTelemetryLedger } from "./telemetry-ledger-io";
import type { UsageRecord } from "../core/types/observability";
export type { UsageRecord };
import { stableCompare } from "../core/util/collate";

export const METRICS_SCHEMA_VERSION = 1 as const;

const VERIFIER_PASS_STATUSES = new Set(["verified", "completed", "committed"]);
const VERIFIER_FAIL_STATUSES = new Set(["failed", "rejected", "blocked"]);
const CANDIDATE_ACCEPTED_STATUSES = new Set(["selected", "verified"]);

export interface CostPolicy {
  schemaVersion: 1;
  id?: string;
  currency?: string;
  models?: Array<{ model: string; inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number }>;
  defaultPrice?: { inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number };
}

export interface RateMetric {
  metric: string;
  state: "ok" | "n/a";
  count: number | null;
  total: number;
  rate: number | null;
  buckets?: Record<string, number>;
}

export interface DurationMetric {
  startedAt?: string;
  endedAt?: string;
  wallClockMs: number | null;
  inFlight: boolean;
}

export interface UsageTotals {
  units: number;
  attestedUnits: number;
  unreportedUnits: number;
  coverage: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  models: string[];
}

export type CostState = "attested" | "estimated" | "unpriced" | "unreported";

export interface CostMetric {
  state: CostState;
  currency: string;
  attestedUsd: number | null;
  estimatedUsd: number | null;
  policyId?: string;
  unpricedModels: string[];
  pricedCoverage: number | null;
  notes: string[];
}

export interface MetricsUsageRow {
  unit: string;
  kind: "task" | "worker";
  usage: UsageRecord;
}

export interface MetricsAttestationCoverage {
  units: number;
  attested: number;
  unattested: number;
  absent: number;
  unverified: number;
  verifiedCoverage: number | null;
  ledger: { present: boolean; verified: boolean; records: number };
}

export interface MetricsDurationRow {
  id: string;
  kind: "task" | "worker";
  status: string;
  duration: DurationMetric;
}

export type MetricsFreshnessStatus = "valid" | "stale" | "absent";

export interface MetricsCollaboration {
  approvals: number;
  rejections: number;
  comments: number;
  handoffs: number;
  reviewers: number;
  approvalRate: RateMetric;
  timeToApproval: { samples: number; meanMs: number | null; maxMs: number | null };
}

export interface MetricsReport {
  schemaVersion: 1;
  surface: "metrics";
  runId: string;
  generatedAt: string;
  sourceFingerprint: string;
  freshness: { status: MetricsFreshnessStatus; persistedFingerprint?: string; currentFingerprint: string };
  scope: { app?: string; backendIds: string[] };
  time: { run: DurationMetric; activeTaskMs: number; inFlight: number; tasks: MetricsDurationRow[]; workers: MetricsDurationRow[] };
  rates: { failure: RateMetric; verifierPass: RateMetric; candidateAcceptance: RateMetric };
  usage: UsageTotals;
  cost: CostMetric;
  attestedUsage: MetricsUsageRow[];
  attestation: MetricsAttestationCoverage;
  collaboration: MetricsCollaboration;
  nextAction: string;
}

export interface MetricsRunRef {
  runId: string;
  repo?: string;
  app?: string;
  backendIds: string[];
  freshness: MetricsFreshnessStatus;
  rates: MetricsReport["rates"];
  usage: UsageTotals;
  cost: CostMetric;
}

export interface MetricsGroupRollup {
  key: string;
  runCount: number;
  rates: MetricsReport["rates"];
  usage: UsageTotals;
  cost: CostMetric;
}

export interface MetricsSummaryReport {
  schemaVersion: 1;
  surface: "metrics";
  scope: "repo" | "home";
  generatedAt: string;
  runCount: number;
  unreadableRuns: number;
  rates: MetricsReport["rates"];
  usage: UsageTotals;
  cost: CostMetric;
  totalOutputBytes: number;
  byBackendCost: Array<{ backendId: string; runCount: number; outputBytes: number }>;
  byApp: MetricsGroupRollup[];
  byBackend: MetricsGroupRollup[];
  runs: MetricsRunRef[];
  nextAction: string;
}

function fingerprintStrings(values: string[]): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const hash = createHash("sha256");
  hash.update(JSON.stringify([...values].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function durationMsBetween(startedAt?: string, endedAt?: string): number | null {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const delta = end - start;
  return delta >= 0 ? delta : null;
}

function duration(startedAt?: string, endedAt?: string): DurationMetric {
  return { startedAt, endedAt, wallClockMs: durationMsBetween(startedAt, endedAt), inFlight: !endedAt };
}

function rate(metric: string, count: number, total: number, buckets?: Record<string, number>): RateMetric {
  if (total <= 0) return { metric, state: "n/a", count: null, total: 0, rate: null, buckets };
  return { metric, state: "ok", count, total, rate: round(count / total, 6), buckets };
}

function usageKey(usage?: UsageRecord): string {
  if (!usage) return "unreported";
  return `${usage.source}:${usage.model || "-"}:${usage.inputTokens ?? "-"}:${usage.outputTokens ?? "-"}`;
}

export function fingerprintMetricsSource(run: WorkflowRun): string {
  const parts: string[] = [`id:${run.id}`, `createdAt:${run.createdAt}`, `updatedAt:${run.updatedAt}`, `app:${(run.workflow.app as { id?: string } | undefined)?.id || run.workflow.id}`];
  for (const task of [...run.tasks].sort((a, b) => stableCompare(a.id, b.id))) {
    parts.push(`task:${task.id}:${task.status}:${task.dispatchedAt || "-"}:${task.completedAt || "-"}:${usageKey((task as unknown as { usage?: UsageRecord }).usage)}:${task.backendId || "-"}`);
  }
  for (const worker of [...((run.workers as unknown as WorkerScope[]) || [])].sort((a, b) => stableCompare(a.id, b.id))) {
    parts.push(`worker:${worker.id}:${worker.status}:${(worker.output as { recordedAt?: string } | undefined)?.recordedAt || "-"}:${usageKey(worker.usage as UsageRecord | undefined)}:${worker.backendId || "-"}`);
  }
  for (const node of [...(run.nodes || [])].filter((n) => n.kind === "verifier").sort((a, b) => stableCompare(a.id, b.id))) {
    parts.push(`verifier:${node.id}:${node.status}`);
  }
  for (const cand of [...((run.candidates as Array<{ id: string; status: string }>) || [])].sort((a, b) => stableCompare(a.id, b.id))) {
    parts.push(`candidate:${cand.id}:${cand.status}`);
  }
  for (const fb of [...((run.feedback as Array<{ id: string; status: string }>) || [])].sort((a, b) => stableCompare(a.id, b.id))) {
    parts.push(`feedback:${fb.id}:${fb.status}`);
  }
  for (const m of [...((run.multiAgent?.memberships as Array<{ id: string; status: string }>) || [])].sort((a, b) => stableCompare(a.id, b.id))) {
    parts.push(`membership:${m.id}:${m.status}`);
  }
  return fingerprintStrings(parts);
}

function workerEndAt(worker: WorkerScope): string | undefined {
  const output = worker.output as { recordedAt?: string } | undefined;
  if (output?.recordedAt) return output.recordedAt;
  if (["completed", "verified", "failed", "rejected"].includes(worker.status)) return worker.updatedAt;
  return undefined;
}

function usageUnits(run: WorkflowRun): Array<{ unit: string; kind: "task" | "worker"; usage?: UsageRecord }> {
  const units: Array<{ unit: string; kind: "task" | "worker"; usage?: UsageRecord }> = [];
  const outputTaskIds = new Set<string>();
  for (const worker of (run.workers as unknown as WorkerScope[]) || []) {
    if (worker.output) {
      const output = worker.output as { taskId?: string };
      outputTaskIds.add(output.taskId || worker.taskId);
      units.push({ unit: worker.id, kind: "worker", usage: worker.usage as UsageRecord | undefined });
    }
  }
  for (const task of run.tasks) {
    if (task.status === "completed" && !outputTaskIds.has(task.id)) {
      units.push({ unit: task.id, kind: "task", usage: (task as unknown as { usage?: UsageRecord }).usage });
    }
  }
  return units.sort((a, b) => stableCompare(a.unit, b.unit));
}

function tokenTotal(usage: UsageRecord): number {
  if (typeof usage.totalTokens === "number") return usage.totalTokens;
  return (usage.inputTokens || 0) + (usage.outputTokens || 0);
}

export function deriveUsageTotals(run: WorkflowRun): { totals: UsageTotals; rows: MetricsUsageRow[] } {
  const units = usageUnits(run);
  const rows: MetricsUsageRow[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  const models = new Set<string>();
  let attestedUnits = 0;
  for (const u of units) {
    if (!u.usage) continue;
    attestedUnits++;
    inputTokens += u.usage.inputTokens || 0;
    outputTokens += u.usage.outputTokens || 0;
    totalTokens += tokenTotal(u.usage);
    if (u.usage.model) models.add(u.usage.model);
    rows.push({ unit: u.unit, kind: u.kind, usage: u.usage });
  }
  const unitCount = units.length;
  const totals: UsageTotals = {
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

export function deriveAttestationCoverage(run: WorkflowRun): MetricsAttestationCoverage {
  const units = usageUnits(run);
  let attested = 0;
  let unattested = 0;
  let absent = 0;
  let unverified = 0;
  for (const u of units) {
    if (!u.usage) continue;
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
  const ledger = verifyTelemetryLedger(run);
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

function priceUsage(usage: UsageRecord, price: { inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number }): number {
  const input = ((usage.inputTokens || 0) / 1_000_000) * price.inputPerMillion;
  const output = ((usage.outputTokens || 0) / 1_000_000) * price.outputPerMillion;
  const cacheRead = ((usage.cacheReadTokens || 0) / 1_000_000) * (price.cacheReadPerMillion || 0);
  const cacheWrite = ((usage.cacheWriteTokens || 0) / 1_000_000) * (price.cacheWritePerMillion || 0);
  return input + output + cacheRead + cacheWrite;
}

export function deriveCost(rows: MetricsUsageRow[], policy?: CostPolicy): CostMetric {
  const currency = policy?.currency || "USD";
  if (rows.length === 0) {
    return { state: "unreported", currency, attestedUsd: null, estimatedUsd: null, policyId: policy?.id, unpricedModels: [], pricedCoverage: null, notes: ["No attested usage on this run; cost is unreported, not zero."] };
  }
  if (!policy) {
    return { state: "unpriced", currency, attestedUsd: null, estimatedUsd: null, unpricedModels: [], pricedCoverage: null, notes: ["Attested usage present but no pricing policy supplied; pass --pricing <path> to price it."] };
  }
  const byModel = new Map<string, { model: string; inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number }>();
  for (const m of policy.models || []) byModel.set(m.model, m);

  let attestedUsd = 0;
  let estimatedUsd = 0;
  let pricedTokens = 0;
  let attestedTokens = 0;
  let usedDefault = false;
  let usedExact = false;
  const unpriced = new Set<string>();

  for (const rowUsage of rows.map((r) => r.usage)) {
    const tokens = tokenTotal(rowUsage);
    attestedTokens += tokens;
    const model = rowUsage.model;
    const exact = model ? byModel.get(model) : undefined;
    const price = exact || policy.defaultPrice;
    if (!price) {
      if (model) unpriced.add(model);
      continue;
    }
    const cost = priceUsage(rowUsage, price);
    pricedTokens += tokens;
    if (exact) {
      attestedUsd += cost;
      usedExact = true;
    } else {
      estimatedUsd += cost;
      usedDefault = true;
      if (model) unpriced.add(model);
    }
  }

  let state: CostState;
  if (pricedTokens === 0) state = "unpriced";
  else if (usedDefault) state = "estimated";
  else if (usedExact) state = "attested";
  else state = "unpriced";

  const notes: string[] = [];
  if (usedDefault) notes.push("Some models lacked an exact policy entry and were priced with the policy default; that portion is `estimated`, not `attested`.");
  if (state === "unpriced") notes.push("Attested usage present but no policy entry (and no default) priced it; cost is unpriced.");

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

export function deriveFailureRate(run: WorkflowRun): RateMetric {
  const workers = (run.workers as unknown as WorkerScope[]) || [];
  const memberships = (run.multiAgent?.memberships as Array<{ status: string }>) || [];
  const feedback = (run.feedback as Array<{ status: string }>) || [];
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

export function deriveVerifierPassRate(run: WorkflowRun): RateMetric {
  const gates = (run.nodes || []).filter((n) => n.kind === "verifier");
  const buckets: Record<string, number> = {};
  let passed = 0;
  let decided = 0;
  for (const gate of gates) {
    buckets[gate.status] = (buckets[gate.status] || 0) + 1;
    if (VERIFIER_PASS_STATUSES.has(gate.status)) {
      passed++;
      decided++;
    } else if (VERIFIER_FAIL_STATUSES.has(gate.status)) {
      decided++;
    }
  }
  return rate("verifier-pass", passed, decided, buckets);
}

export function deriveCandidateAcceptanceRate(run: WorkflowRun): RateMetric {
  const candidates = (run.candidates as Array<{ status: string }>) || [];
  const buckets: Record<string, number> = {};
  let accepted = 0;
  for (const cand of candidates) {
    buckets[cand.status] = (buckets[cand.status] || 0) + 1;
    if (CANDIDATE_ACCEPTED_STATUSES.has(cand.status)) accepted++;
  }
  return rate("candidate-acceptance", accepted, candidates.length, buckets);
}

function taskRows(run: WorkflowRun): MetricsDurationRow[] {
  return run.tasks
    .map((task: RunTask) => ({ id: task.id, kind: "task" as const, status: task.status, duration: duration(task.dispatchedAt, task.completedAt) }))
    .sort((a, b) => stableCompare(a.id, b.id));
}

function workerRows(run: WorkflowRun): MetricsDurationRow[] {
  return ((run.workers as unknown as WorkerScope[]) || [])
    .map((worker) => ({ id: worker.id, kind: "worker" as const, status: worker.status, duration: duration(worker.createdAt, workerEndAt(worker)) }))
    .sort((a, b) => stableCompare(a.id, b.id));
}

export interface DeriveMetricsOptions {
  now: string;
  policy?: CostPolicy;
  persistedFingerprint?: string;
}

function targetCreatedAt(run: WorkflowRun, target: { kind: string; id: string }): string | undefined {
  if (target.kind === "candidate") return ((run.candidates as Array<{ id: string; createdAt?: string }>) || []).find((e) => e.id === target.id)?.createdAt;
  if (target.kind === "commit") return (run.commits || []).find((e) => e.id === target.id)?.createdAt;
  if (target.kind === "selection") return ((run.candidateSelections as Array<{ id: string; selectedAt?: string }>) || []).find((e) => e.id === target.id)?.selectedAt;
  return undefined;
}

export function deriveCollaborationMetrics(run: WorkflowRun): MetricsCollaboration {
  const collab = run.collaboration;
  const approvalRecords = ((collab?.approvals as Array<{ decision: string; actor?: { id?: string }; target: { kind: string; id: string }; createdAt: string }>) || []).filter((r) => r.decision === "approve");
  const rejectionRecords = ((collab?.approvals as Array<{ decision: string }>) || []).filter((r) => r.decision === "reject");
  const reviewers = new Set(approvalRecords.map((r) => r.actor?.id).filter((id) => id && id !== "unattributed"));

  const samples: number[] = [];
  for (const record of approvalRecords) {
    const createdAt = targetCreatedAt(run, record.target);
    const ms = durationMsBetween(createdAt, record.createdAt);
    if (ms !== null) samples.push(ms);
  }
  const meanMs = samples.length ? Math.round(samples.reduce((acc, ms) => acc + ms, 0) / samples.length) : null;
  const maxMs = samples.length ? Math.max(...samples) : null;

  return {
    approvals: approvalRecords.length,
    rejections: rejectionRecords.length,
    comments: ((collab?.comments as unknown[]) || []).length,
    handoffs: ((collab?.handoffs as unknown[]) || []).length,
    reviewers: reviewers.size,
    approvalRate: rate("approval", approvalRecords.length, approvalRecords.length + rejectionRecords.length, { approve: approvalRecords.length, reject: rejectionRecords.length }),
    timeToApproval: { samples: samples.length, meanMs, maxMs },
  };
}

export function deriveMetricsReport(run: WorkflowRun, options: DeriveMetricsOptions): MetricsReport {
  const tasks = taskRows(run);
  const workers = workerRows(run);
  const activeTaskMs = tasks.reduce((acc, row) => acc + (row.duration.wallClockMs || 0), 0);
  const inFlight = tasks.filter((t) => t.duration.inFlight).length + workers.filter((w) => w.duration.inFlight).length;

  const pendingOrRunning = run.tasks.filter((t) => t.status === "pending" || t.status === "running").length;
  const runDuration: DurationMetric = { startedAt: run.createdAt, endedAt: run.updatedAt, wallClockMs: durationMsBetween(run.createdAt, run.updatedAt), inFlight: pendingOrRunning > 0 };

  const { totals, rows } = deriveUsageTotals(run);
  const cost = deriveCost(rows, options.policy);
  const currentFingerprint = fingerprintMetricsSource(run);

  let status: MetricsFreshnessStatus;
  if (!options.persistedFingerprint) status = "absent";
  else if (options.persistedFingerprint === currentFingerprint) status = "valid";
  else status = "stale";

  const backendIds = new Set<string>();
  for (const task of run.tasks) if (task.backendId) backendIds.add(task.backendId);
  for (const worker of (run.workers as unknown as WorkerScope[]) || []) if (worker.backendId) backendIds.add(worker.backendId);

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    surface: "metrics",
    runId: run.id,
    generatedAt: options.now,
    sourceFingerprint: currentFingerprint,
    freshness: { status, persistedFingerprint: options.persistedFingerprint, currentFingerprint },
    scope: { app: (run.workflow.app as { id?: string } | undefined)?.id || run.workflow.id, backendIds: [...backendIds].sort() },
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

export function metricsDir(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "metrics");
}

function metricsReportPath(run: WorkflowRun): string {
  return path.join(metricsDir(run), "metrics-report.json");
}

export function loadPersistedMetricsFingerprint(run: WorkflowRun): string | undefined {
  const file = metricsReportPath(run);
  if (!fs.existsSync(file)) return undefined;
  try {
    return (readJson(file) as MetricsReport).sourceFingerprint;
  } catch {
    return undefined;
  }
}

/** Derive + persist the per-run report. The RETURNED payload is pinned to
 *  `freshness: "valid"` (persistedFingerprint === itself) so `cw metrics
 *  show --json` and the MCP tool are byte-identical. The Workbench's private
 *  projection mode keeps that established payload but does not create a
 *  derived file; NEVER touches state.json (invariant 6). */
export function showMetricsReport(run: WorkflowRun, options: { now: string; policy?: CostPolicy; persist?: boolean }): MetricsReport {
  const live = deriveMetricsReport(run, { now: options.now, policy: options.policy });
  const report: MetricsReport = { ...live, freshness: { status: "valid", persistedFingerprint: live.sourceFingerprint, currentFingerprint: live.sourceFingerprint } };
  if (options.persist !== false) {
    fs.mkdirSync(metricsDir(run), { recursive: true });
    writeJson(metricsReportPath(run), report);
  }
  return report;
}

function poolRates(metric: string, rates: RateMetric[]): RateMetric {
  let count = 0;
  let total = 0;
  const buckets: Record<string, number> = {};
  for (const r of rates) {
    total += r.total;
    count += r.count || 0;
    for (const [k, v] of Object.entries(r.buckets || {})) buckets[k] = (buckets[k] || 0) + v;
  }
  return rate(metric, count, total, buckets);
}

function poolUsage(list: UsageTotals[]): UsageTotals {
  let units = 0;
  let attestedUnits = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  const models = new Set<string>();
  for (const u of list) {
    units += u.units;
    attestedUnits += u.attestedUnits;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    totalTokens += u.totalTokens;
    for (const m of u.models) models.add(m);
  }
  return { units, attestedUnits, unreportedUnits: units - attestedUnits, coverage: units > 0 ? round(attestedUnits / units, 6) : null, inputTokens, outputTokens, totalTokens, models: [...models].sort() };
}

function poolCost(list: CostMetric[]): CostMetric {
  const currency = list.find((c) => c.currency)?.currency || "USD";
  let attestedUsd: number | null = null;
  let estimatedUsd: number | null = null;
  const unpriced = new Set<string>();
  let anyAttested = false;
  let anyEstimated = false;
  let anyUnpriced = false;
  let anyReported = false;
  let policyId: string | undefined;
  for (const c of list) {
    if (c.attestedUsd !== null) {
      attestedUsd = round((attestedUsd || 0) + c.attestedUsd, 6);
      anyAttested = true;
    }
    if (c.estimatedUsd !== null) {
      estimatedUsd = round((estimatedUsd || 0) + c.estimatedUsd, 6);
      anyEstimated = true;
    }
    for (const m of c.unpricedModels) unpriced.add(m);
    if (c.state === "unpriced") anyUnpriced = true;
    if (c.state !== "unreported") anyReported = true;
    if (c.policyId) policyId = c.policyId;
  }
  let state: CostState;
  if (!anyReported) state = "unreported";
  else if (anyEstimated) state = "estimated";
  else if (anyAttested) state = "attested";
  else if (anyUnpriced) state = "unpriced";
  else state = "unreported";
  const notes: string[] = [];
  if (anyAttested && anyEstimated) notes.push("Totals mix exact-priced (attested) and default-priced (estimated) runs; the two USD figures are kept separate.");
  return { state, currency, attestedUsd, estimatedUsd, policyId, unpricedModels: [...unpriced].sort(), pricedCoverage: null, notes };
}

export interface SummaryRunInput {
  run: WorkflowRun;
  repo?: string;
  persistedFingerprint?: string;
}

export function deriveMetricsSummary(inputs: SummaryRunInput[], options: { now: string; scope: "repo" | "home"; policy?: CostPolicy; unreadableRuns?: number }): MetricsSummaryReport {
  const perRun: Array<{ ref: MetricsRunRef; report: MetricsReport }> = [];
  for (const input of inputs) {
    const report = deriveMetricsReport(input.run, { now: options.now, policy: options.policy, persistedFingerprint: input.persistedFingerprint });
    perRun.push({ report, ref: { runId: report.runId, repo: input.repo, app: report.scope.app, backendIds: report.scope.backendIds, freshness: report.freshness.status, rates: report.rates, usage: report.usage, cost: report.cost } });
  }
  perRun.sort((a, b) => stableCompare(a.report.runId, b.report.runId));

  const groupBy = (keyOf: (r: MetricsReport) => string[]): MetricsGroupRollup[] => {
    const map = new Map<string, MetricsReport[]>();
    for (const { report } of perRun) {
      for (const key of keyOf(report)) {
        const list = map.get(key) || [];
        list.push(report);
        map.set(key, list);
      }
    }
    return [...map.entries()]
      .sort((a, b) => stableCompare(a[0], b[0]))
      .map(([key, reports]) => ({
        key,
        runCount: reports.length,
        rates: { failure: poolRates("failure", reports.map((r) => r.rates.failure)), verifierPass: poolRates("verifier-pass", reports.map((r) => r.rates.verifierPass)), candidateAcceptance: poolRates("candidate-acceptance", reports.map((r) => r.rates.candidateAcceptance)) },
        usage: poolUsage(reports.map((r) => r.usage)),
        cost: poolCost(reports.map((r) => r.cost)),
      }));
  };

  const allReports = perRun.map((p) => p.report);
  const totalOutputBytes = inputs.reduce((sum, input) => sum + ((input.run.workers as unknown as WorkerScope[]) || []).reduce((ws, w) => ws + (w.outputSizeBytes || 0), 0), 0);
  const computePerBackendCost = (inputList: SummaryRunInput[]): Array<{ backendId: string; runCount: number; outputBytes: number }> => {
    const map = new Map<string, { runCount: number; outputBytes: number }>();
    for (const input of inputList) {
      const backends = new Set(((input.run.workers as unknown as WorkerScope[]) || []).map((w) => w.backendId || "node"));
      const bytes = ((input.run.workers as unknown as WorkerScope[]) || []).reduce((s, w) => s + (w.outputSizeBytes || 0), 0);
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
    schemaVersion: METRICS_SCHEMA_VERSION,
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

export { loadCostPolicy, parseUsageFromArgs } from "./observability-intake";
export { formatMetricsReport, formatMetricsSummary } from "./observability-format";

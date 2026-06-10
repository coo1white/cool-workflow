import type { TrustAuditSource } from "./trust";

// ---------------------------------------------------------------------------
// Observability + Cost Accounting (v0.1.31)
//
// DERIVED, NOT A TELEMETRY PIPELINE. Every metric below is a PROJECTION of
// existing durable run state — timestamps → durations, verifier nodes → pass
// rate, candidates → acceptance rate, failed workers/feedback → failure rate.
// There is no metrics database, no collector daemon, no hidden counter.
//
// COST IS ATTESTED, NEVER MEASURED. CW does not call the model; the host/worker
// does. Token usage is recorded as HOST-ATTESTED provenance (UsageRecord on the
// task/worker record), never invented. Absent usage is `unreported` — never 0.
// A monetary figure is `attested` only when derived from attested usage × a
// recorded pricing policy; otherwise it is clearly `estimated`/`unpriced`. The
// two are NEVER conflated.
//
// A COUNTER YOU CANNOT TRUST IS WORSE THAN NONE. A rate over zero samples is
// `n/a`, never 0%/100%. Every rate carries its numerator + denominator.
// ---------------------------------------------------------------------------

/** Who attested a UsageRecord. CW itself is NEVER the source — it does not call
 *  the model, so "cw-validated"/"runtime-derived" are deliberately excluded. */
export type UsageAttestationSource = Extract<TrustAuditSource, "host-attested" | "operator-recorded">;

/** Host-attested token usage for ONE unit of work (a task result or a worker
 *  output). Additive + optional; recorded verbatim as provenance. Absent means
 *  `unreported`, NEVER zero. CW never synthesizes this. */
export interface UsageRecord {
  schemaVersion: 1;
  /** The attesting source. CW does not measure usage; the host/worker reports it. */
  source: UsageAttestationSource;
  /** Host-reported model id (free-form, e.g. "claude-opus-4-8"). */
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Optional extra token buckets some hosts report. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Host-reported total; when absent, derived from input+output for display. */
  totalTokens?: number;
  /** When the host attested this (RECORDED, not "now"). */
  attestedAt: string;
  /** Free-text note / attesting tool id. */
  note?: string;
  metadata?: Record<string, unknown>;
}

/** A rate over a finite, EXPLICIT sample. FAIL CLOSED: zero samples ⇒ state
 *  "n/a" (insufficient data), never a fabricated 0%/100%. count/total are always
 *  present so a reader can audit the rate. */
export type RateState = "ok" | "n/a";
export interface RateMetric {
  /** What the rate measures, e.g. "verifier-pass". */
  metric: string;
  state: RateState;
  /** Numerator (e.g. passed gates); null when state === "n/a". */
  count: number | null;
  /** Denominator (e.g. gates run); 0 ⇒ state "n/a". */
  total: number;
  /** count/total in [0,1], deterministically rounded; null when "n/a". */
  rate: number | null;
  /** Per-bucket sample breakdown for inspection (e.g. {failed:2,rejected:1}). */
  buckets?: Record<string, number>;
}

/** A duration derived from RECORDED timestamps (never from when the report ran).
 *  In-flight items (missing the end timestamp) are marked explicitly with a null
 *  duration — never a now-based guess. */
export interface DurationMetric {
  /** ISO start (recorded). */
  startedAt?: string;
  /** ISO end (recorded); undefined ⇒ in-flight. */
  endedAt?: string;
  /** endedAt-startedAt in ms; null when in-flight or unknown. */
  wallClockMs: number | null;
  inFlight: boolean;
}

/** Aggregate attested token usage + the coverage backing it. `unreported` work
 *  is surfaced as its own count, never folded into zero. */
export interface UsageTotals {
  /** Work units considered (task results + worker outputs). */
  units: number;
  /** Of `units`, how many carried an attested UsageRecord. */
  attestedUnits: number;
  /** units - attestedUnits, surfaced as `unreported` (never zero). */
  unreportedUnits: number;
  /** attestedUnits/units in [0,1]; null when units === 0. */
  coverage: number | null;
  /** Summed attested tokens (over attested units only). */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Distinct attested model ids seen, sorted. */
  models: string[];
}

/** Cost provenance state. `attested` ONLY when from attested usage × a recorded
 *  policy; `estimated` when pricing is assumed (default/fallback); `unpriced`
 *  when attested usage exists but no policy covers its models; `unreported` when
 *  there is no attested usage to price. attested and estimated never conflated. */
export type CostState = "attested" | "estimated" | "unpriced" | "unreported";

export interface CostMetric {
  state: CostState;
  currency: string;
  /** Cost from attested usage priced by an EXACT policy match. null when none. */
  attestedUsd: number | null;
  /** Cost where pricing was ASSUMED (policy default/fallback). Separate figure. */
  estimatedUsd: number | null;
  /** Pricing policy id used, if any. */
  policyId?: string;
  /** Attested models with NO pricing entry (drive `unpriced`/`estimated`). */
  unpricedModels: string[];
  /** Priced tokens / attested tokens, [0,1] or null. */
  pricedCoverage: number | null;
  notes: string[];
}

/** Per-model price in USD per 1e6 tokens. POLICY, not kernel: supplied as data,
 *  swappable without touching the runtime. */
export interface ModelPrice {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

/** A pricing table. Mechanism (the runtime) consumes this; the table itself is
 *  POLICY — configurable data, default `unpriced`/`estimated` when absent. */
export interface CostPolicy {
  schemaVersion: 1;
  id: string;
  currency: string;
  /** Exact model id → price. Matching is exact against the host-attested id. */
  models: ModelPrice[];
  /** Optional fallback for unmatched models; using it marks cost `estimated`. */
  defaultPrice?: Omit<ModelPrice, "model">;
  source?: string;
}

export type MetricsFreshnessStatus = "valid" | "stale" | "absent";

/** Where a run's work ran, for rollups. Derived from existing fields only. */
export interface MetricsScopeRef {
  app?: string;
  backendIds: string[];
}

/** A per-item duration row (task or worker), derived from recorded timestamps. */
export interface MetricsDurationRow {
  id: string;
  kind: "task" | "worker";
  status: string;
  duration: DurationMetric;
}

/** A per-unit attested-usage row (attested units only), for inspection. */
export interface MetricsUsageRow {
  unit: string;
  kind: "task" | "worker";
  usage: UsageRecord;
}

/** The DERIVED per-run observability + cost report. A pure projection of one
 *  run's durable state + an injected `now` (the only now-derived field is
 *  `generatedAt`; all durations come from recorded timestamps), priced by an
 *  optional CostPolicy. Deterministic over a fixed snapshot. */
export interface MetricsReport {
  schemaVersion: 1;
  surface?: "metrics";
  runId: string;
  /** Injected wall-clock at report time (ISO). The ONLY now-derived field. */
  generatedAt: string;
  /** Content fingerprint of the source state these metrics derive from. */
  sourceFingerprint: string;
  freshness: {
    status: MetricsFreshnessStatus;
    persistedFingerprint?: string;
    currentFingerprint: string;
  };
  scope: MetricsScopeRef;
  time: {
    /** Run wall-clock: createdAt → updatedAt (both recorded). */
    run: DurationMetric;
    /** Sum of completed task active durations (dispatchedAt → completedAt). */
    activeTaskMs: number;
    /** Count of items with no recorded end timestamp. */
    inFlight: number;
    tasks: MetricsDurationRow[];
    workers: MetricsDurationRow[];
  };
  rates: {
    failure: RateMetric;
    verifierPass: RateMetric;
    candidateAcceptance: RateMetric;
  };
  usage: UsageTotals;
  cost: CostMetric;
  /** Attested per-unit usage rows (attested only); empty when all unreported. */
  attestedUsage: MetricsUsageRow[];
  /** Team-collaboration (v0.1.32) metrics, derived from append-only records and
   *  recorded timestamps only (no now-derived numbers). */
  collaboration: MetricsCollaboration;
  nextAction: string;
}

/** DERIVED collaboration metrics: counts, approval rate, and time-to-approval
 *  computed from recorded timestamps (deterministic over a fixed snapshot). */
export interface MetricsCollaboration {
  approvals: number;
  rejections: number;
  comments: number;
  handoffs: number;
  /** Distinct counted approvers across all gated targets. */
  reviewers: number;
  /** approvals / (approvals + rejections); n/a when no decisions. */
  approvalRate: RateMetric;
  /** Wall-clock from a target's creation to its approval, from recorded
   *  timestamps. samples is the number of measurable approvals. */
  timeToApproval: {
    samples: number;
    meanMs: number | null;
    maxMs: number | null;
  };
}

/** A compact rollup of one run inside the cross-repo summary. */
export interface MetricsRunRef {
  runId: string;
  repo?: string;
  app?: string;
  backendIds: string[];
  /** Freshness of the PERSISTED per-run snapshot vs current source (fail-closed:
   *  `absent` when never persisted, `stale` when source changed since). The
   *  aggregate numbers are always derived from CURRENT source, regardless. */
  freshness: MetricsFreshnessStatus;
  rates: {
    failure: RateMetric;
    verifierPass: RateMetric;
    candidateAcceptance: RateMetric;
  };
  usage: UsageTotals;
  cost: CostMetric;
}

/** A grouped rollup (per app or per backend) inside the cross-repo summary. */
export interface MetricsGroupRollup {
  key: string;
  runCount: number;
  rates: {
    failure: RateMetric;
    verifierPass: RateMetric;
    candidateAcceptance: RateMetric;
  };
  usage: UsageTotals;
  cost: CostMetric;
}

/** The DERIVED cross-repo observability + cost rollup over the run registry.
 *  Rates pool samples across runs; usage/cost sum attested values with explicit
 *  coverage; per-app and per-backend rollups are provided where the data exists. */
export interface MetricsSummaryReport {
  schemaVersion: 1;
  surface?: "metrics";
  scope: "repo" | "home";
  generatedAt: string;
  runCount: number;
  /** Runs whose source was unreadable (fail closed; counted, never faked). */
  unreadableRuns: number;
  rates: {
    failure: RateMetric;
    verifierPass: RateMetric;
    candidateAcceptance: RateMetric;
  };
  usage: UsageTotals;
  cost: CostMetric;
  /** Total bytes of worker output across all runs (v0.1.62). */
  totalOutputBytes: number;
  /** Per-backend cost breakdown with run counts (v0.1.66). */
  byBackendCost: Array<{ backendId: string; runCount: number; outputBytes: number }>;
  byApp: MetricsGroupRollup[];
  byBackend: MetricsGroupRollup[];
  runs: MetricsRunRef[];
  nextAction: string;
}

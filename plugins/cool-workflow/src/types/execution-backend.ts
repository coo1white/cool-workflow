import type { ResultEnvelope } from "./result";
import type { ResolvedSandboxPolicy } from "./sandbox";
import type { WorkerManifest } from "./worker";

// ---------------------------------------------------------------------------
// Execution Backends (v0.1.29) — the driver layer.
//
// BSD discipline: ONE narrow `ExecutionBackend` interface (mechanism); many
// interchangeable drivers (node/bun/shell/container/remote/ci). The kernel
// (orchestrator/dispatch/pipeline-runner) MUST NOT know which backend ran a
// task. WHAT to run and which evidence to record is kernel policy; HOW/WHERE it
// runs is the driver's concern. The sandbox profile is THE contract: every
// backend either enforces or attests each required dimension, or it FAILS CLOSED.
// The result/evidence envelope is schema-identical across backends; the backend
// id + sandbox attestation are recorded AS provenance.
// ---------------------------------------------------------------------------

/** The five sandbox-profile dimensions a backend must honor. */
export type SandboxDimension = "read" | "write" | "command" | "network" | "env";

/** Local: the driver runs the work on this host (in-process or via a child
 *  process). Remote: the driver delegates to a runner elsewhere. */
export type BackendLocality = "local" | "remote";

/** Driver model (BSD VFS): `local` drivers run the work directly; `delegating`
 *  drivers hand execution to a container/remote/CI runner and record a handle +
 *  attestation + result rather than executing themselves. */
export type BackendKind = "local" | "delegating";

/** Fail-closed readiness. `ready` = usable now; `unavailable` = a required
 *  dependency is absent; `unverified` = readiness could not be established (probe
 *  to confirm). A backend that is not `ready` MUST refuse to run. */
export type BackendReadiness = "ready" | "unavailable" | "unverified";

/** How a backend treats one sandbox dimension. `enforce` = actively restricts it
 *  at execution time; `attest` = records a verifiable claim but relies on the
 *  host/runner to enforce it; `unsupported` = can neither enforce nor attest it
 *  (a profile requiring this dimension fails closed on this backend). */
export type SandboxDimensionSupport = "enforce" | "attest" | "unsupported";

export interface BackendCapability {
  dimension: SandboxDimension;
  support: SandboxDimensionSupport;
  detail?: string;
}

/** The capability descriptor for one backend — plain, inspectable, diffable. */
export interface BackendDescriptor {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  kind: BackendKind;
  locality: BackendLocality;
  /** The behavior-preserving default (node). Exactly one backend is default. */
  default: boolean;
  /** Per-dimension support — the heart of the capability descriptor. */
  capabilities: BackendCapability[];
  /** Dimensions this backend can ENFORCE (derived from `capabilities`). */
  enforces: SandboxDimension[];
  /** Dimensions this backend can ATTEST but not enforce (derived). */
  attests: SandboxDimension[];
  /** External dependency a delegating driver drives (e.g. docker, bun runner). */
  delegate?: string;
  /** Static baseline readiness; `backend probe` reports live readiness. */
  readiness: BackendReadiness;
}

export interface BackendProbeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Live readiness probe for one backend. Deterministic given the host. */
export interface BackendProbeResult {
  schemaVersion: 1;
  backendId: string;
  locality: BackendLocality;
  kind: BackendKind;
  readiness: BackendReadiness;
  ready: boolean;
  enforces: SandboxDimension[];
  attests: SandboxDimension[];
  checks: BackendProbeCheck[];
  reason?: string;
}

export type BackendSelectionSource = "flag" | "env" | "task" | "default";

/** How a backend was selected for a task — recorded in run state. */
export interface BackendSelection {
  backendId: string;
  source: BackendSelectionSource;
  requested?: string;
}

export type SandboxAttestationStatus = "enforced" | "attested" | "refused";

/** Opaque handle a delegating backend records for the execution it drove. */
export interface BackendExecutionHandle {
  kind: "container" | "remote" | "ci" | "process";
  /** Stable reference: image@digest, endpoint+jobId, ci job url, etc. */
  ref: string;
  image?: string;
  digest?: string;
  endpoint?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
}

/** What a backend actually enforced vs attested for one run. Recorded AS
 *  provenance — eval/replay/verifier/registry do not care which backend produced
 *  it. A non-empty `unenforceable` means the backend refused (fail closed). */
export interface SandboxAttestation {
  schemaVersion: 1;
  backendId: string;
  locality: BackendLocality;
  kind: BackendKind;
  sandboxProfileId: string;
  /** Dimensions the profile requires to be restricted. */
  required: SandboxDimension[];
  /** Of `required`, the dimensions this backend enforced at execution time. */
  enforced: SandboxDimension[];
  /** Of `required`, the dimensions this backend attested (host/runner enforces). */
  attested: SandboxDimension[];
  /** Required dimensions this backend can neither enforce nor attest. */
  unenforceable: SandboxDimension[];
  status: SandboxAttestationStatus;
  /** Mirror of the resolved sandbox enforcement split, for inspection. */
  enforcedByCW: string[];
  hostRequired: string[];
  recordedAt: string;
  /** For delegating backends: the handle to the delegated execution. */
  handle?: BackendExecutionHandle;
  notes?: string[];
}

export type ExecutionStatus = "completed" | "failed" | "refused";

/** What the kernel asks a backend to run. The backend is told WHAT to run + the
 *  sandbox contract; HOW/WHERE is its concern. */
export interface ExecutionRequest {
  schemaVersion: 1;
  runId?: string;
  taskId?: string;
  backendId: string;
  /** A shell-free command + args to execute. Worker-manifest dispatch leaves this
   *  undefined; the node default reproduces today's host-runs-the-worker model. */
  command?: string;
  args?: string[];
  cwd: string;
  sandboxPolicy: ResolvedSandboxPolicy;
  /** Optional worker manifest this execution corresponds to. */
  manifest?: WorkerManifest;
  /** Stable label used in deterministic evidence (defaults to the command). */
  label?: string;
  /** Delegation target for delegating backends (image/endpoint/job/agent). */
  delegation?: {
    image?: string;
    digest?: string;
    endpoint?: string;
    jobId?: string;
    /** agent backend (v0.1.38): the external agent BINARY to spawn argv-style
     *  (shell:false). The model lives in the agent's process, never in CW. */
    command?: string;
    /** agent backend: the argv TEMPLATE after the binary. `{{manifest}}`,
     *  `{{input}}`, `{{result}}`, `{{workerDir}}`, `{{model}}`, `{{prompt}}` are
     *  substituted into DISCRETE argv elements (never a shell-interpreted string). */
    args?: string[];
    /** agent backend: OPERATOR-chosen model interpolated into `{{model}}` as
     *  policy-as-data. Recorded ONLY in secret-stripped args provenance — it is
     *  NEVER the source of the attested UsageRecord.model (which comes solely from
     *  what the agent reports back). */
    model?: string;
  };
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

/** Backend identity + sandbox attestation. The part of an execution envelope that
 *  is ALLOWED to differ per backend. */
export interface ExecutionProvenance {
  schemaVersion: 1;
  backendId: string;
  locality: BackendLocality;
  kind: BackendKind;
  attestation: SandboxAttestation;
  handle?: BackendExecutionHandle;
}

/** The canonical execution envelope. `result`/`evidence` are SCHEMA-IDENTICAL and
 *  byte-stable across backends for the same task; `provenance` carries the backend
 *  identity + attestation. */
export interface ExecutionResultEnvelope {
  schemaVersion: 1;
  status: ExecutionStatus;
  /** The SAME ResultEnvelope schema every CW result uses. Never extended here. */
  result: ResultEnvelope;
  /** Canonical evidence refs (deterministic; backend-independent). */
  evidence: string[];
  provenance: ExecutionProvenance;
}

// ---------------------------------------------------------------------------
// Agent Delegation Drive (v0.1.38) — the `agent` backend delegates each worker
// to an EXTERNAL agent process (claude -p / codex exec / an HTTP agent endpoint)
// and records the attested result. The model runs in the agent's process, NEVER
// inside CW. These are plain provenance records — additive, reusing
// BackendExecutionHandle (`kind: "process"`) and UsageRecord.model. NO model SDK
// type is introduced here.
// ---------------------------------------------------------------------------

/** Vendor-neutral agent delegation config (POLICY, expressed as DATA). Resolved
 *  flags > env (CW_AGENT_COMMAND / CW_AGENT_ENDPOINT / CW_AGENT_MODEL) > a durable
 *  $CW_HOME/agent-config.json. claude / codex / ollama / an HTTP endpoint are
 *  CONFIGS, never CW dependencies. Fails closed when neither command nor endpoint
 *  is configured. */
export interface AgentDelegationConfig {
  schemaVersion: 1;
  /** The agent BINARY to spawn argv-style (shell:false). */
  command?: string;
  /** The argv TEMPLATE after the binary, with `{{...}}` placeholders. */
  args?: string[];
  /** An HTTP agent endpoint to POST the manifest to (alternative to command). */
  endpoint?: string;
  /** OPERATOR-chosen model interpolated into `{{model}}` — policy, NOT the
   *  attested model. */
  model?: string;
  /** Spawn/POST timeout in ms. */
  timeoutMs?: number;
  /** Where this config was resolved from (provenance for the show verb). */
  source?: "flag" | "env" | "file" | "none";
}

/** The attestation/provenance recorded for ONE agent-fulfilled worker. Lives in
 *  `provenance`/trust-audit and is folded into the snapshotted node body, NEVER in
 *  `evidence`. The `model` here is the agent-REPORTED model (`unreported` when the
 *  agent reports none — never backfilled from CW_AGENT_MODEL). */
export interface AgentDelegationProvenance {
  schemaVersion: 1;
  backendId: "agent";
  /** The agent invocation handle (`kind: "process"`). */
  handle: BackendExecutionHandle;
  /** Agent-REPORTED model id, or `unreported`. Sourced SOLELY from the agent's
   *  own output — never from the operator-chosen CW_AGENT_MODEL. */
  model: string;
  /** sha256 of the worker prompt CW handed the agent (input.md / manifest prompt). */
  promptDigest: string;
  /** sha256 of the accepted result.md. */
  resultDigest: string;
  /** The secret-stripped agent command + args provenance (redacted). */
  command?: string;
  args: string[];
  /** The agent child's exit code (null = no exit reported). */
  exitCode: number | null;
}

/** The narrow driver contract. One interface; many interchangeable drivers. */
export interface ExecutionBackend {
  descriptor: BackendDescriptor;
  probe(context: { cwd?: string }): BackendProbeResult;
  run(request: ExecutionRequest): ExecutionResultEnvelope;
}

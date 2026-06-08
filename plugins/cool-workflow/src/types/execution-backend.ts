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
  /** Delegation target for delegating backends (image/endpoint/job). */
  delegation?: {
    image?: string;
    digest?: string;
    endpoint?: string;
    jobId?: string;
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

/** The narrow driver contract. One interface; many interchangeable drivers. */
export interface ExecutionBackend {
  descriptor: BackendDescriptor;
  probe(context: { cwd?: string }): BackendProbeResult;
  run(request: ExecutionRequest): ExecutionResultEnvelope;
}

// Execution Backends (v0.1.29) — the driver layer.
//
// BSD discipline, modeled on a VFS / device-driver layer:
//  - MECHANISM vs POLICY. ONE narrow `ExecutionBackend` contract (mechanism);
//    many interchangeable drivers (node/bun/shell/container/remote/ci). The kernel
//    (orchestrator/dispatch/pipeline-runner) never learns which backend ran a
//    task. WHAT to run and which evidence to record is kernel policy; HOW/WHERE it
//    runs is the driver's concern.
//  - THE SANDBOX PROFILE IS THE CONTRACT. Every backend maps the resolved sandbox
//    profile's five dimensions (read/write/command/network/env) onto its own
//    enforcement and ATTESTS what it actually enforced. A backend that can neither
//    enforce nor attest a required dimension — or that is not ready — FAILS CLOSED
//    and refuses to run. It never silently downgrades to unsandboxed execution.
//  - IDENTICAL ENVELOPES, ANY BACKEND. `runBackend` returns a canonical
//    ExecutionResultEnvelope whose `result`/`evidence` are schema-identical and
//    byte-stable across backends for the same task; the backend id + sandbox
//    attestation are recorded AS provenance.
//  - CW DELEGATES, IT DOES NOT BECOME THE EXECUTOR. The local drivers run a thin
//    child process to capture verifiable evidence (exit + output digest). The
//    container/remote/ci drivers DELEGATE and record a handle + attestation +
//    result; they never reimplement a container runtime or a CI system.
//
// See docs/execution-backends.7.md.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AgentChildOutcome,
  BackendCapability,
  BackendDescriptor,
  BackendExecutionHandle,
  BackendKind,
  BackendLocality,
  BackendProbeCheck,
  BackendProbeResult,
  BackendReadiness,
  BackendSelection,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResultEnvelope,
  ResolvedSandboxPolicy,
  ResultEnvelope,
  SandboxAttestation,
  SandboxDimension,
  SandboxDimensionSupport
} from "./types";
// Pure leaf helpers — carved into ./execution-backend/util.ts (god-module carve).
// `sha256` is re-exported below to keep the public surface byte-identical.
import { sha256, hasExecutable, firstString, messageOf } from "./execution-backend/util";
// Per-backend readiness probe bodies — carved into ./execution-backend/probes.ts.
import {
  probeNodeBackend,
  probeShellBackend,
  probeBunBackend,
  probeContainerBackend,
  probeRemoteBackend,
  probeCiBackend,
  probeAgentBackend
} from "./execution-backend/probes";
// Agent-delegation pure helpers + concurrent batch — carved into
// ./execution-backend/agent.ts. The public symbols (stripSecretArgs,
// AgentSpawnJob, prepareAgentSpawn, runAgentBatchOutcomes) are re-exported below.
import {
  AgentInvocation,
  resolveAgentInvocation,
  stripSecretArgs,
  parseAgentReport,
  agentSubstitutions,
  substituteAgentArg,
  recordedAgentHandle,
  extractEndpointResult,
  agentHandle
} from "./execution-backend/agent";

// Re-export the carved public surface so every importer of "./execution-backend"
// is byte-unchanged (no public signature changed; pure code movement).
export { sha256 } from "./execution-backend/util";
export { stripSecretArgs, prepareAgentSpawn, runAgentBatchOutcomes } from "./execution-backend/agent";
export type { AgentSpawnJob } from "./execution-backend/agent";

export const EXECUTION_BACKEND_SCHEMA_VERSION = 1;
export const DEFAULT_BACKEND_ID = "node";
export const SANDBOX_DIMENSIONS: SandboxDimension[] = ["read", "write", "command", "network", "env"];

export class BackendError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// The driver table. Plain, inspectable data — one row per driver. `capabilities`
// describes what the driver can do when it EXECUTES a command; the delegate-host
// (dispatch) path narrows this to CW's own enforcement (write acceptance).
// ---------------------------------------------------------------------------

export interface DriverSpec {
  id: string;
  title: string;
  description: string;
  kind: BackendKind;
  locality: BackendLocality;
  default: boolean;
  delegate?: string;
  readiness: BackendReadiness;
  support: Record<SandboxDimension, SandboxDimensionSupport>;
}

const DRIVER_SPECS: DriverSpec[] = [
  {
    id: "node",
    title: "Node (default)",
    description:
      "Default backend. Reproduces pre-v0.1.29 behavior exactly: the host runs the worker in-process under CW's worker-output acceptance. When executing a command it enforces the command + env policy via the Node child process and attests OS read/write/network isolation to the host.",
    kind: "local",
    locality: "local",
    default: true,
    readiness: "ready",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" }
  },
  {
    id: "bun",
    title: "Bun",
    description:
      "Bun-friendly backend. Node-compatible by default: it executes via the Node-compatible runtime so evidence is byte-stable with the node backend, and attests Bun availability in provenance. Enforces command + env via the child process; attests read/write/network to the host.",
    kind: "local",
    locality: "local",
    default: false,
    delegate: "bun",
    readiness: "ready",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" }
  },
  {
    id: "shell",
    title: "Shell",
    description:
      "Runs a command/worker via the system shell (/bin/sh -c) under the sandbox contract. Enforces command + env via the child process; attests read/write/network to the host.",
    kind: "local",
    locality: "local",
    default: false,
    delegate: "/bin/sh",
    readiness: "ready",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" }
  },
  {
    id: "container",
    title: "Container",
    description:
      "Delegates execution to a container runtime (docker/podman) and records the image@digest handle + attestation + result. A container can enforce all five dimensions via mounts, dropped capabilities, a network namespace, and a filtered env. Fails closed when no image is supplied or no runtime is present.",
    kind: "delegating",
    locality: "local",
    default: false,
    delegate: "docker",
    readiness: "unverified",
    support: { read: "enforce", write: "enforce", command: "enforce", network: "enforce", env: "enforce" }
  },
  {
    id: "remote",
    title: "Remote Runner",
    description:
      "Delegates execution to a remote runner and records the endpoint + job handle + attestation + result. Enforces command + env at the remote; attests read/write/network. Fails closed when no endpoint is configured.",
    kind: "delegating",
    locality: "remote",
    default: false,
    delegate: "remote-runner",
    readiness: "unverified",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" }
  },
  {
    id: "ci",
    title: "CI Runner",
    description:
      "Delegates execution to a CI runner and records the job handle + attestation + result. Enforces command + env in the CI job; attests read/write/network. Fails closed when no CI job target is configured.",
    kind: "delegating",
    locality: "remote",
    default: false,
    delegate: "ci-runner",
    readiness: "unverified",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" }
  },
  {
    id: "agent",
    title: "Agent (external process)",
    description:
      "Delegates each worker to an EXTERNAL agent process (claude -p / codex exec / an HTTP agent endpoint) and records the agent CHILD's command + exit + stdout digest as the canonical evidence triple, plus a kind:process handle and the agent-reported model + prompt/result digests as provenance. The MODEL runs in the agent's process, NEVER in CW — CW imports no model SDK and holds no API key; it spawns an out-of-process child argv-style (shell:false) or POSTs to a configured endpoint. CW enforces only the exact argv it spawns; the agent host attests read/write/network/env. Fails closed when no command-template/endpoint is configured, on non-zero exit, or on a missing/invalid result.md.",
    kind: "delegating",
    locality: "local",
    default: false,
    delegate: "agent-process",
    readiness: "unverified",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "attest" }
  }
];

function specCapabilities(spec: DriverSpec): BackendCapability[] {
  return SANDBOX_DIMENSIONS.map((dimension) => ({ dimension, support: spec.support[dimension] }));
}

function specDescriptor(spec: DriverSpec): BackendDescriptor {
  const capabilities = specCapabilities(spec);
  return {
    schemaVersion: 1,
    id: spec.id,
    title: spec.title,
    description: spec.description,
    kind: spec.kind,
    locality: spec.locality,
    default: spec.default,
    capabilities,
    enforces: capabilities.filter((cap) => cap.support === "enforce").map((cap) => cap.dimension),
    attests: capabilities.filter((cap) => cap.support === "attest").map((cap) => cap.dimension),
    delegate: spec.delegate,
    readiness: spec.readiness
  };
}

// ---------------------------------------------------------------------------
// Backend registry (v0.1.40 self-audit P3 maintainability seam).
//
// Replaces the hardcoded id-branching (the shell-vs-direct check in executeLocal
// and the container/agent/http switch in delegate) and the flat DRIVER_SPECS
// scans with a registry keyed by backend id. A driver is a `spec` + how it runs:
// a local driver carries a `spawnStyle`; a delegating driver carries a
// `delegateRun`. Built-ins register at module load; a host can `registerBackend`
// a new one (e.g. kubernetes/serverless) WITHOUT editing a central switch — it
// then appears in list/ids/descriptor/run uniformly. Pure mechanism; the kernel
// still never learns which backend ran a task.
// ---------------------------------------------------------------------------

export interface DelegateRunContext {
  descriptor: BackendDescriptor;
  policy: ResolvedSandboxPolicy;
  request: ExecutionRequest;
  label: string;
  handle: BackendExecutionHandle;
  attestation: SandboxAttestation;
}

export type DelegateRun = (ctx: DelegateRunContext) => ExecutionResultEnvelope;

/** The backend-specific part of a probe: the variable readiness/checks/reason a
 *  driver computes. probeBackend wraps it with the descriptor-derived envelope. */
export interface BackendProbeBody {
  checks: BackendProbeCheck[];
  readiness: BackendReadiness;
  reason?: string;
}

export interface BackendDriver {
  spec: DriverSpec;
  /** Local drivers only: how `executeLocal` spawns the child. */
  spawnStyle?: "direct" | "shell";
  /** Local drivers only: the provenance note recorded for an execution. */
  runtimeNote?: () => string;
  /** Delegating drivers only: run after the handle + attestation are resolved. */
  delegateRun?: DelegateRun;
  /** Delegating drivers only: resolve the delegation handle (or undefined when
   *  unconfigured → fail-closed refusal). */
  buildHandle?: (request: ExecutionRequest) => BackendExecutionHandle | undefined;
  /** Delegating drivers only: this backend's command is carried by its handle, so
   *  it does not require `request.command` (the agent backend). */
  commandlessDelegate?: boolean;
  /** Readiness probe — the backend-specific checks/readiness/reason. */
  probe?: (context: { cwd?: string }) => BackendProbeBody;
}

const BACKEND_REGISTRY = new Map<string, BackendDriver>();

/** Register (or override) a backend driver. The public extension seam. */
export function registerBackend(driver: BackendDriver): void {
  BACKEND_REGISTRY.set(driver.spec.id, driver);
}

export function getBackendDriver(id: string): BackendDriver | undefined {
  return BACKEND_REGISTRY.get(id);
}

function registeredDrivers(): BackendDriver[] {
  return [...BACKEND_REGISTRY.values()];
}

export function listBackendDescriptors(): BackendDescriptor[] {
  return registeredDrivers()
    .map((driver) => specDescriptor(driver.spec))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function backendIds(): string[] {
  return registeredDrivers()
    .map((driver) => driver.spec.id)
    .sort();
}

export function isBackendId(id: string | undefined): id is string {
  return Boolean(id) && BACKEND_REGISTRY.has(id as string);
}

export function getBackendDescriptor(id: string): BackendDescriptor {
  const driver = BACKEND_REGISTRY.get(id);
  if (!driver) {
    throw new BackendError("backend-not-found", `Execution backend not found: ${id}`, { backendId: id, available: backendIds() });
  }
  return specDescriptor(driver.spec);
}

// Register the built-in drivers, each as a COMPLETE self-description: spec +
// every behavior that used to live behind a `descriptor.id === "..."` branch
// (spawn style, runtime note, delegate runner, handle builder, commandless flag,
// readiness probe). Adding a backend now means registerBackend({ spec, ...behaviors })
// — no central switch to edit. Function declarations below are hoisted, so the
// closures resolve at call time.
const BUILTIN_DRIVER_BEHAVIORS: Record<string, Omit<BackendDriver, "spec">> = {
  node: { spawnStyle: "direct", runtimeNote: () => "node", probe: probeNodeBackend },
  bun: {
    spawnStyle: "direct",
    runtimeNote: () => (hasExecutable("bun") ? "bun (node-compatible execution)" : "node-compatible (bun not installed)"),
    probe: probeBunBackend
  },
  shell: { spawnStyle: "shell", runtimeNote: () => "posix-shell", probe: probeShellBackend },
  container: { delegateRun: ctxDelegate(runContainer), buildHandle: containerHandle, probe: probeContainerBackend },
  remote: { delegateRun: ctxDelegate(runHttpDelegation), buildHandle: remoteHandle, probe: probeRemoteBackend },
  ci: { delegateRun: ctxDelegate(runHttpDelegation), buildHandle: ciHandle, probe: probeCiBackend },
  agent: {
    delegateRun: ctxDelegate(runAgentProcess),
    buildHandle: agentHandle,
    commandlessDelegate: true,
    probe: probeAgentBackend
  }
};

for (const spec of DRIVER_SPECS) {
  registerBackend({ spec, ...(BUILTIN_DRIVER_BEHAVIORS[spec.id] || {}) });
}

type DelegateImpl = (
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation
) => ExecutionResultEnvelope;

function ctxDelegate(impl: DelegateImpl): DelegateRun {
  return (ctx) => impl(ctx.descriptor, ctx.policy, ctx.request, ctx.label, ctx.handle, ctx.attestation);
}

// ---------------------------------------------------------------------------
// Selection & resolution. `--backend <id>` (flag) > CW_BACKEND (env) > default.
// ---------------------------------------------------------------------------

export function resolveBackendSelection(
  requested?: string,
  env: NodeJS.ProcessEnv = process.env
): BackendSelection {
  const normalizedRequested = requested && requested.trim() ? requested.trim() : undefined;
  if (normalizedRequested) {
    if (!isBackendId(normalizedRequested)) {
      throw new BackendError("backend-not-found", `Unknown execution backend: ${normalizedRequested}`, {
        backendId: normalizedRequested,
        available: backendIds()
      });
    }
    return { backendId: normalizedRequested, source: "flag", requested: normalizedRequested };
  }
  const envBackend = env.CW_BACKEND && env.CW_BACKEND.trim() ? env.CW_BACKEND.trim() : undefined;
  if (envBackend) {
    if (!isBackendId(envBackend)) {
      throw new BackendError("backend-not-found", `Unknown execution backend in CW_BACKEND: ${envBackend}`, {
        backendId: envBackend,
        available: backendIds()
      });
    }
    return { backendId: envBackend, source: "env", requested: envBackend };
  }
  return { backendId: DEFAULT_BACKEND_ID, source: "default" };
}

// ---------------------------------------------------------------------------
// Sandbox dimension mapping + attestation. The sandbox profile is the contract.
// ---------------------------------------------------------------------------

/** The dimensions a resolved profile requires to be restricted. */
export function requiredSandboxDimensions(policy: ResolvedSandboxPolicy): SandboxDimension[] {
  const required: SandboxDimension[] = [];
  // read/write are always bounded for a resolved CW policy (path allowlist +
  // worker-output acceptance), so they are always required.
  required.push("read");
  required.push("write");
  if (policy.execute.mode !== "any") required.push("command");
  if (policy.network.mode !== "any") required.push("network");
  if (policy.env.inherit === false) required.push("env");
  return required;
}

export interface AttestOptions {
  /** "execute" = the backend runs the command itself (probe/build/verify).
   *  "delegate-host" = the host runs the worker (the classic dispatch path);
   *  the backend enforces only what CW enforces (write acceptance) and attests
   *  the rest to the host, reproducing pre-v0.1.29 behavior exactly. */
  mode: "execute" | "delegate-host";
  ready?: boolean;
  handle?: BackendExecutionHandle;
  notes?: string[];
  recordedAt?: string;
}

export function attestSandbox(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  options: AttestOptions = { mode: "execute" }
): SandboxAttestation {
  const required = requiredSandboxDimensions(policy);
  const supportByDimension = new Map(descriptor.capabilities.map((cap) => [cap.dimension, cap.support] as const));
  const enforced: SandboxDimension[] = [];
  const attested: SandboxDimension[] = [];
  const unenforceable: SandboxDimension[] = [];

  for (const dimension of required) {
    const declared = supportByDimension.get(dimension) || "unsupported";
    let effective: SandboxDimensionSupport = declared;
    if (options.mode === "delegate-host" && declared !== "unsupported") {
      // The host runs the worker; CW enforces only worker-output acceptance
      // (write). Everything else is attested to the host.
      effective = dimension === "write" ? "enforce" : "attest";
    }
    if (effective === "enforce") enforced.push(dimension);
    else if (effective === "attest") attested.push(dimension);
    else unenforceable.push(dimension);
  }

  const refusedForReadiness = options.ready === false;
  const status: SandboxAttestation["status"] =
    unenforceable.length || refusedForReadiness ? "refused" : enforced.length ? "enforced" : "attested";

  return {
    schemaVersion: 1,
    backendId: descriptor.id,
    locality: descriptor.locality,
    kind: descriptor.kind,
    sandboxProfileId: policy.id,
    required,
    enforced,
    attested,
    unenforceable,
    status,
    enforcedByCW: policy.enforcement.enforcedByCW,
    hostRequired: policy.enforcement.hostRequired,
    recordedAt: options.recordedAt || new Date().toISOString(),
    handle: options.handle,
    notes: options.notes
  };
}

// ---------------------------------------------------------------------------
// Readiness probe. Deterministic given the host (PATH + configured env).
// ---------------------------------------------------------------------------

export function probeBackend(id: string, context: { cwd?: string } = {}): BackendProbeResult {
  const descriptor = getBackendDescriptor(id);
  const driver = BACKEND_REGISTRY.get(id);
  // The driver owns its readiness checks; probeBackend just wraps them with the
  // descriptor-derived envelope. A driver with no probe is unverified by default.
  const body: BackendProbeBody = driver?.probe
    ? driver.probe(context)
    : { checks: [], readiness: descriptor.readiness };
  return {
    schemaVersion: 1,
    backendId: descriptor.id,
    locality: descriptor.locality,
    kind: descriptor.kind,
    readiness: body.readiness,
    ready: body.readiness === "ready",
    enforces: descriptor.enforces,
    attests: descriptor.attests,
    checks: body.checks,
    reason: body.reason
  };
}

// ---------------------------------------------------------------------------
// The run entry. Refuses (fail closed) when the sandbox cannot be honored, the
// command is denied by policy, or the backend is not ready. Local drivers spawn a
// thin child process; delegating drivers record a handle and never execute here.
// ---------------------------------------------------------------------------

export function runBackend(request: ExecutionRequest): ExecutionResultEnvelope {
  const descriptor = getBackendDescriptor(request.backendId);
  const policy = request.sandboxPolicy;
  const label = request.label || request.command || `${descriptor.id}-execution`;
  const probe = probeBackend(descriptor.id, { cwd: request.cwd });

  // 1. Command policy. A profile that denies commands (execute.mode "none" or an
  //    allowlist miss) must refuse — never run an out-of-policy command.
  if (request.command) {
    const denied = commandDenied(policy, `${request.command} ${(request.args || []).join(" ")}`.trim());
    if (denied) {
      return refusedEnvelope(descriptor, policy, label, "sandbox-command-denied", denied, { ready: probe.ready });
    }
  }

  // 2. Sandbox attestation (execute mode). Any unenforceable required dimension
  //    is a fail-closed refusal.
  const attestation = attestSandbox(descriptor, policy, { mode: "execute", ready: probe.ready });
  if (attestation.unenforceable.length) {
    return refusedEnvelope(
      descriptor,
      policy,
      label,
      "sandbox-unenforceable",
      `Backend ${descriptor.id} cannot enforce or attest required sandbox dimension(s): ${attestation.unenforceable.join(", ")}`,
      { ready: probe.ready, attestation }
    );
  }

  // 3. Delegating drivers: delegate + record a handle. No local execution.
  if (descriptor.kind === "delegating") {
    return delegate(descriptor, policy, request, label, probe);
  }

  // 4. Readiness. A local backend that is not ready refuses.
  if (!probe.ready) {
    return refusedEnvelope(descriptor, policy, label, "backend-not-ready", probe.reason || `Backend ${descriptor.id} is not ready`, {
      ready: false,
      attestation
    });
  }

  // 5. Local execution: spawn a thin child process and capture verifiable
  //    evidence (exit code + output digest).
  if (!request.command) {
    return refusedEnvelope(descriptor, policy, label, "no-command", `Backend ${descriptor.id} requires a command to execute`, {
      ready: probe.ready,
      attestation
    });
  }
  return executeLocal(descriptor, policy, request, label, attestation);
}

function executeLocal(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const command = String(request.command);
  const args = (request.args || []).map(String);
  const env = buildChildEnv(policy);
  const options = {
    cwd: request.cwd,
    env,
    encoding: "utf8" as const,
    timeout: request.timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  };

  // shell backend runs via /bin/sh -c; node/bun run the command directly
  // (bun is Node-compatible by default so evidence stays byte-stable with node).
  // spawnStyle comes from the registered driver, not a hardcoded id check.
  const spawnStyle = getBackendDriver(descriptor.id)?.spawnStyle;
  if (spawnStyle === "shell") {
    // Shell injection guard: reject args that contain shell control characters
    // (beyond template placeholders). The command itself is operator-configured.
    const shellArg = [command, ...args].join(" ").replace(/\{\{[a-zA-Z0-9_.-]+\}\}/g, "");
    if (/[;&|`$(){}<>!\n\r#*?~]/.test(shellArg)) {
      throw new Error(
        `Shell backend refused: args contain shell control characters. ` +
        `Use the node, bun, or agent backend instead for untrusted inputs.`
      );
    }
  }
  const isTTY = process.stderr.isTTY;
  const shortLabel = command.split("/").pop() || command;
  if (isTTY) process.stderr.write(`● Running ${shortLabel}...\n`);
  const startedAt = process.hrtime.bigint();
  const result =
    spawnStyle === "shell"
      ? spawnSync([command, ...args].join(" "), { ...options, shell: true })
      : spawnSync(command, args, { ...options, shell: false });
  const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  if (isTTY) process.stderr.write(`✓ Done (${elapsedMs}ms)\n`);

  const exitCode = typeof result.status === "number" ? result.status : null;
  const spawnError = result.error ? messageOf(result.error) : undefined;
  const stdout = String(result.stdout || "");
  const digest = sha256(stdout);
  const status = spawnError ? "failed" : exitCode === 0 ? "completed" : "failed";

  const evidence = [
    `command:${[command, ...args].join(" ")}`,
    `exitCode:${exitCode === null ? "null" : exitCode}`,
    `stdoutSha256:${digest}`
  ];
  const summary =
    status === "completed"
      ? `${label}: completed (exit 0)`
      : spawnError
        ? `${label}: failed (${spawnError})`
        : `${label}: failed (exit ${exitCode})`;
  const resultEnvelope: ResultEnvelope = { summary, findings: [], evidence };

  const notes = [`runtime: ${runtimeNote(descriptor)}`];
  if (spawnError) notes.push(`spawn-error: ${spawnError}`);

  return {
    schemaVersion: 1,
    status,
    result: resultEnvelope,
    evidence,
    provenance: {
      schemaVersion: 1,
      backendId: descriptor.id,
      locality: descriptor.locality,
      kind: descriptor.kind,
      attestation: { ...attestation, status: attestation.status, notes }
    }
  };
}

function delegate(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  probe: BackendProbeResult
): ExecutionResultEnvelope {
  const handle = delegationHandle(descriptor, request);
  if (!handle) {
    return refusedEnvelope(
      descriptor,
      policy,
      label,
      "delegation-target-missing",
      probe.reason || `Backend ${descriptor.id} has no delegation target; refusing rather than running unsandboxed`,
      { ready: probe.ready }
    );
  }
  // A delegating backend that really executes needs a command. Refuse otherwise
  // rather than fabricate a completed run. A driver whose command is carried by its
  // handle (the agent backend) sets commandlessDelegate and is exempt.
  if (!getBackendDriver(descriptor.id)?.commandlessDelegate && !request.command) {
    return refusedEnvelope(descriptor, policy, label, "no-command", `Backend ${descriptor.id} requires a command to delegate`, {
      ready: probe.ready
    });
  }
  const attestation = attestSandbox(descriptor, policy, {
    mode: "execute",
    ready: true,
    handle,
    notes: [`delegated: ${descriptor.id} -> ${handle.ref}`]
  });

  // v0.1.34: drivers REALLY execute. The result/evidence are the SAME canonical
  // shape executeLocal produces (command:/exitCode:/stdoutSha256:), so a delegated
  // run is byte-stable against node; the handle lives in provenance, NEVER in
  // evidence. Any runtime/transport failure FAILS CLOSED (refused), never a
  // fabricated completion. The driver's registered delegateRun replaces the old
  // id switch.
  const driver = getBackendDriver(descriptor.id);
  if (!driver?.delegateRun) {
    return refusedEnvelope(descriptor, policy, label, "backend-not-runnable", `Backend ${descriptor.id} has no delegate runner`, {
      ready: probe.ready,
      attestation
    });
  }
  return driver.delegateRun({ descriptor, policy, request, label, handle, attestation });
}

/** Build the canonical completed/failed envelope shared by every real backend —
 *  identical to executeLocal's, so evidence is byte-stable across backends. The
 *  handle is recorded in provenance only. */
function delegatedEnvelope(
  descriptor: BackendDescriptor,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation,
  command: string,
  args: string[],
  exitCode: number | null,
  stdout: string
): ExecutionResultEnvelope {
  const digest = sha256(stdout);
  const status: ExecutionResultEnvelope["status"] = exitCode === 0 ? "completed" : "failed";
  const evidence = [
    `command:${[command, ...args].join(" ")}`,
    `exitCode:${exitCode === null ? "null" : exitCode}`,
    `stdoutSha256:${digest}`
  ];
  const summary =
    status === "completed" ? `${label}: completed (exit 0)` : `${label}: failed (exit ${exitCode === null ? "null" : exitCode})`;
  return {
    schemaVersion: 1,
    status,
    result: { summary, findings: [], evidence },
    evidence,
    provenance: {
      schemaVersion: 1,
      backendId: descriptor.id,
      locality: descriptor.locality,
      kind: descriptor.kind,
      attestation,
      handle
    }
  };
}

/** container — real `docker`/`podman run` under the sandbox contract. Maps the
 *  profile onto container isolation (network namespace, read-only workspace mount,
 *  filtered env) and captures the container command's exit + stdout digest. Fails
 *  closed when no runtime is on PATH, the daemon is unreachable, or the runtime
 *  itself errors (exit 125) — distinct from the command's own non-zero exit. */
function runContainer(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const runtime = hasExecutable("docker") ? "docker" : hasExecutable("podman") ? "podman" : undefined;
  if (!runtime) {
    return refusedEnvelope(descriptor, policy, label, "runtime-unavailable", "no container runtime (docker/podman) on PATH", {
      attestation
    });
  }
  // Daemon pre-flight. A present CLI with an UNREACHABLE daemon must fail closed —
  // never be mistaken for a container command that ran and exited non-zero (the
  // run exit code is not a reliable daemon-down signal across runtimes). `version
  // --format {{.Server.Version}}` returns the SERVER version only when reachable.
  const ping = spawnSync(runtime, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 15000 });
  const daemonUp = !ping.error && ping.status === 0 && String(ping.stdout || "").trim().length > 0;
  if (!daemonUp) {
    const why = (String(ping.stderr || "").split("\n").find((line) => line.trim()) || `${runtime} daemon not reachable`).trim();
    return refusedEnvelope(descriptor, policy, label, "runtime-unavailable", `${runtime} daemon is not reachable: ${why}`, {
      attestation
    });
  }
  const command = String(request.command);
  const args = (request.args || []).map(String);
  const cwd = request.cwd || process.cwd();

  const runArgs = ["run", "--rm"];
  // network: enforce isolation when the policy restricts it (container kernel
  // namespace genuinely enforces this — that is why `network` is declared enforce).
  if (policy.network.mode !== "any") runArgs.push("--network", "none");
  // read/write: mount the workspace read-only at the same path; CW's own
  // worker-output acceptance still bounds writes. (Write-through mounts can be a
  // later refinement; read-only is the safe default.)
  runArgs.push("-v", `${cwd}:${cwd}:ro`, "-w", cwd);
  // env: only the explicitly exposed names cross into the container — the image
  // provides its own PATH/HOME, so we never inject host-specific base env.
  if (policy.env.inherit || (policy.env.expose && policy.env.expose.length)) {
    for (const name of policy.env.inherit ? Object.keys(process.env) : policy.env.expose || []) {
      if (name === "PATH" || name === "HOME") continue;
      const value = process.env[name];
      if (value !== undefined) runArgs.push("-e", `${name}=${value}`);
    }
  }
  runArgs.push(handle.ref, command, ...args);

  const result = spawnSync(runtime, runArgs, {
    cwd,
    encoding: "utf8",
    timeout: request.timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });

  if (result.error) {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${runtime} run failed: ${messageOf(result.error)}`, {
      attestation
    });
  }
  const exitCode = typeof result.status === "number" ? result.status : null;
  // docker/podman exit 125 = the runtime itself failed (daemon down, bad image,
  // bad flags) — NOT the container command's exit. Fail closed, do not record a
  // command result that never ran.
  if (exitCode === 125 || exitCode === null) {
    const why = (String(result.stderr || "").split("\n").find((line) => line.trim()) || "container runtime error").trim();
    return refusedEnvelope(descriptor, policy, label, "runtime-unavailable", `${runtime} could not run the container: ${why}`, {
      attestation
    });
  }
  return delegatedEnvelope(descriptor, label, handle, attestation, command, args, exitCode, String(result.stdout || ""));
}

// The remote/CI delegation child is a real, packaged Node script (not an embedded
// `node -e` string — F11): it reads a JSON job on stdin, POSTs it to the endpoint,
// optionally polls a returned jobId, and prints `{ exitCode, stdout }` (or
// `{ error }`) on stdout. Node-only (global fetch, node >=18), so the driver stays
// portable and synchronous from CW's view. We spawn it BY PATH (shell:false). The
// path is resolved from this compiled module (dist/execution-backend.js) up to the
// package's `scripts/children/` dir, which package.json ships in "files".
export function delegateChildScript(): string {
  const resolved = path.resolve(__dirname, "..", "scripts", "children", "http-delegate-child.js");
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Delegate child script not found at ${resolved}. ` +
      `This indicates a broken installation — reinstall cool-workflow or ensure ` +
      `"scripts/children/http-delegate-child.js" is shipped in the package.`
    );
  }
  return resolved;
}

/** The shared HTTP delegation child script path (resolved at import time). */
const HTTP_DELEGATE_CHILD_SCRIPT = delegateChildScript();

/** remote / ci — real HTTP delegation. POSTs the job to the configured endpoint
 *  (and polls a returned jobId) via a Node child, then records the runner's exit +
 *  stdout digest as canonical evidence. Fails closed when the endpoint is missing,
 *  unreachable, errors, or returns no exitCode. Untestable without a live runner,
 *  but the refusal paths are exercised by the smoke. */
function runHttpDelegation(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const endpoint = handle.endpoint;
  if (!endpoint) {
    return refusedEnvelope(descriptor, policy, label, "delegation-target-missing", `Backend ${descriptor.id} has no endpoint to POST to`, {
      attestation
    });
  }
  const command = String(request.command);
  const args = (request.args || []).map(String);
  const job = JSON.stringify({
    command,
    args,
    env: buildChildEnv(policy),
    sandboxProfileId: policy.id,
    jobId: handle.jobId
  });

  const child = spawnSync(process.execPath, [HTTP_DELEGATE_CHILD_SCRIPT], {
    input: job,
    env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
    encoding: "utf8",
    timeout: request.timeoutMs || 120000,
    maxBuffer: 32 * 1024 * 1024
  });
  if (child.error) {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${descriptor.id} delegation failed: ${messageOf(child.error)}`, {
      attestation
    });
  }
  let parsed: { exitCode?: number; stdout?: string; error?: string };
  try {
    parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
  } catch {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${descriptor.id} runner returned an unparseable response`, {
      attestation
    });
  }
  if (parsed.error || typeof parsed.exitCode !== "number") {
    return refusedEnvelope(
      descriptor,
      policy,
      label,
      "delegation-failed",
      `${descriptor.id} runner error: ${parsed.error || "no exitCode reported"}`,
      { attestation }
    );
  }
  return delegatedEnvelope(descriptor, label, handle, attestation, command, args, parsed.exitCode, String(parsed.stdout || ""));
}

// ---------------------------------------------------------------------------
// agent — the v0.1.38 delegating driver. Spawns an EXTERNAL agent process per
// worker (claude -p / codex exec / …) argv-style (shell:false), or POSTs the
// manifest to a configured HTTP agent endpoint. The agent reads the worker
// input/manifest and writes the worker's result.md out-of-process; CW captures
// the agent CHILD's command + exit + stdout digest as the canonical evidence
// triple (NEVER the result.md — that is the separate recordWorkerOutput layer)
// and records the kind:process handle + agent-reported model in provenance.
//
// THE RED LINE: CW spawns the agent and records its attested output. It NEVER
// imports a model SDK, holds an API key, or constructs a model API request. Any
// API key flows from the agent's OWN inherited env; CW never reads or records it.
// The operator-chosen CW_AGENT_MODEL is interpolated into `{{model}}` as policy
// and recorded ONLY in secret-stripped args — it is NEVER the attested model id.
//
// The pure agent helpers (resolveAgentInvocation, stripSecretArgs, parseAgentReport,
// agentSubstitutions, substituteAgentArg, recordedAgentHandle, extractEndpointResult,
// agentHandle) and the concurrent batch live in ./execution-backend/agent.ts; the
// stateful runners below build the refusal/delegated envelopes and stay here.

function runAgentProcess(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const resolved = resolveAgentInvocation(request);
  const subst = agentSubstitutions(request, resolved.model);

  if (resolved.binary) {
    const realArgs = resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst));
    const recordedArgs = stripSecretArgs(realArgs);
    // Spawn the agent argv-style — shell:false, never a shell-interpreted string.
    // The agent inherits the host env so ITS OWN credentials resolve; CW neither
    // reads nor records them. CW enforces only the exact argv it spawns.
    // Track 2: a concurrent round pre-collects the child outcome via the batch
    // delegate child; when present it settles through these SAME branches —
    // identical envelopes by construction, no second mapping to drift.
    let outcome: AgentChildOutcome;
    if (request.preparedAgentOutcome) {
      outcome = request.preparedAgentOutcome;
    } else {
      // Live output on by default when stderr is a TTY. stdout is always
      // captured as data. CI/pipes stay silent. CW_AGENT_STREAM=0 or
      // CW_NO_STREAM=1 forces off; CW_AGENT_STREAM=1 forces on.
      const streamStderr = process.env.CW_AGENT_STREAM !== "0" && Boolean(process.stderr.isTTY) && process.env.CW_NO_STREAM !== "1";
      // Build child env from sandbox policy as baseline (respects env.inherit/expose/deny),
      // then re-allow CW_* + well-known API key env vars the agent needs.
      const childEnv = buildChildEnv(policy);
      for (const key of Object.keys(process.env)) {
        if (/^(CW_|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CODEX_|GOOGLE_|COHERE_|MISTRAL_|OLLAMA_|AZURE_|AWS_)/i.test(key)) {
          childEnv[key] = process.env[key];
        }
      }
      const child = spawnSync(resolved.binary, realArgs, {
        cwd: request.cwd,
        env: childEnv,
        encoding: "utf8",
        timeout: resolved.timeoutMs || 600000,
        maxBuffer: 32 * 1024 * 1024,
        shell: false,
        stdio: ["ignore", "pipe", streamStderr ? "inherit" : "pipe"]
      });
      outcome = {
        ...(child.error ? { spawnError: messageOf(child.error) } : {}),
        exitCode: typeof child.status === "number" ? child.status : null,
        stdout: String(child.stdout || "")
      };
    }
    if (outcome.spawnError) {
      const handleOut = recordedAgentHandle(resolved.binary, undefined, recordedArgs, resolved.model, "unreported");
      return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent process failed to spawn: ${outcome.spawnError}`, {
        attestation: { ...attestation, handle: handleOut }
      });
    }
    const exitCode = outcome.exitCode;
    const stdout = outcome.stdout;
    const report = parseAgentReport(stdout);
    const reportedModel = report.model && report.model.trim() ? report.model.trim() : "unreported";
    const handleOut = recordedAgentHandle(resolved.binary, undefined, recordedArgs, resolved.model, reportedModel, report.usage, report.usageSignature);
    if (exitCode === null) {
      // No exit code (timeout/killed) ⇒ fail closed, never a fabricated completion.
      return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent process returned no exit code (timed out or killed)`, {
        attestation: { ...attestation, handle: handleOut }
      });
    }
    // Evidence triple = the agent CHILD's command/exit/stdout digest (secret-stripped
    // command), byte-stable in SHAPE with node/container/remote. exit≠0 ⇒ failed.
    return delegatedEnvelope(descriptor, label, handleOut, { ...attestation, handle: handleOut }, resolved.binary, recordedArgs, exitCode, stdout);
  }

  if (resolved.endpoint) {
    return runAgentEndpoint(descriptor, policy, request, label, resolved, attestation);
  }

  return refusedEnvelope(descriptor, policy, label, "delegation-target-missing", `Backend ${descriptor.id} has no command-template or endpoint configured`, {
    attestation
  });
}

/** Agent HTTP endpoint variant — POSTs the worker manifest/prompt to a configured
 *  agent endpoint via the shared Node delegate child; if the endpoint returns a
 *  `result` body, CW writes it to the worker's result.md (the endpoint agent is the
 *  producer — CW is only transport). Evidence triple = the delegate child's
 *  exit + stdout digest, identical mechanism to runHttpDelegation. Fails closed. */
function runAgentEndpoint(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  resolved: AgentInvocation,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const endpoint = resolved.endpoint as string;
  const manifest = request.manifest;
  const job = JSON.stringify({
    manifest,
    prompt: manifest?.prompt,
    model: resolved.model,
    resultPath: manifest?.resultPath,
    sandboxProfileId: policy.id
  });
  const child = spawnSync(process.execPath, [HTTP_DELEGATE_CHILD_SCRIPT], {
    input: job,
    env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
    encoding: "utf8",
    timeout: resolved.timeoutMs || 600000,
    maxBuffer: 32 * 1024 * 1024
  });
  const baseHandle = recordedAgentHandle(undefined, endpoint, [], resolved.model, "unreported");
  if (child.error) {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint delegation failed: ${messageOf(child.error)}`, {
      attestation: { ...attestation, handle: baseHandle }
    });
  }
  let parsed: { exitCode?: number; stdout?: string; error?: string };
  try {
    parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
  } catch {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint returned an unparseable response`, {
      attestation: { ...attestation, handle: baseHandle }
    });
  }
  if (parsed.error || typeof parsed.exitCode !== "number") {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `agent endpoint error: ${parsed.error || "no exitCode reported"}`, {
      attestation: { ...attestation, handle: baseHandle }
    });
  }
  const stdout = String(parsed.stdout || "");
  // If the endpoint agent returned the result body, CW (as transport) writes it to
  // the worker's result.md for the separate recordWorkerOutput layer to accept.
  const report = parseAgentReport(stdout);
  if (manifest?.resultPath && report.usage === undefined) {
    const body = extractEndpointResult(stdout);
    if (body && !fs.existsSync(manifest.resultPath)) {
      try {
        fs.writeFileSync(manifest.resultPath, body, "utf8");
      } catch {
        /* the accept layer will fail closed on a missing result.md */
      }
    }
  }
  const reportedModel = report.model && report.model.trim() ? report.model.trim() : "unreported";
  const handleOut = recordedAgentHandle(undefined, endpoint, [], resolved.model, reportedModel, report.usage, report.usageSignature);
  return delegatedEnvelope(descriptor, label, handleOut, { ...attestation, handle: handleOut }, "agent-endpoint", [endpoint], parsed.exitCode, stdout);
}

function delegationHandle(descriptor: BackendDescriptor, request: ExecutionRequest): BackendExecutionHandle | undefined {
  return getBackendDriver(descriptor.id)?.buildHandle?.(request);
}

function containerHandle(request: ExecutionRequest): BackendExecutionHandle | undefined {
  const delegation = request.delegation || {};
  const image = delegation.image || (process.env.CW_CONTAINER_IMAGE || "").trim() || undefined;
  if (!image) return undefined;
  const digest = delegation.digest || (process.env.CW_CONTAINER_DIGEST || "").trim() || undefined;
  const ref = digest ? `${image}@${digest}` : image;
  return { kind: "container", ref, image, digest };
}

function remoteHandle(request: ExecutionRequest): BackendExecutionHandle | undefined {
  const delegation = request.delegation || {};
  const endpoint = delegation.endpoint || (process.env.CW_REMOTE_ENDPOINT || "").trim() || undefined;
  if (!endpoint) return undefined;
  const jobId = delegation.jobId || (process.env.CW_REMOTE_JOB || "").trim() || undefined;
  const ref = jobId ? `${endpoint}#${jobId}` : endpoint;
  return { kind: "remote", ref, endpoint, jobId };
}

function ciHandle(request: ExecutionRequest): BackendExecutionHandle | undefined {
  const delegation = request.delegation || {};
  const endpoint = delegation.endpoint || (process.env.CW_CI_ENDPOINT || "").trim() || undefined;
  const jobId = delegation.jobId || (process.env.CW_CI_JOB || "").trim() || undefined;
  if (!endpoint && !jobId) return undefined;
  const ref = endpoint && jobId ? `${endpoint}#${jobId}` : jobId || endpoint || "";
  return { kind: "ci", ref, endpoint, jobId };
}

function refusedEnvelope(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  label: string,
  code: string,
  reason: string,
  options: { ready?: boolean; attestation?: SandboxAttestation } = {}
): ExecutionResultEnvelope {
  const attestation = options.attestation
    ? { ...options.attestation, status: "refused" as const, notes: [...(options.attestation.notes || []), `refused: ${code}`] }
    : { ...attestSandbox(descriptor, policy, { mode: "execute", ready: options.ready }), status: "refused" as const, notes: [`refused: ${code}`] };
  const evidence = [`refused:${code}`, `backend:${descriptor.id}`, `sandbox:${policy.id}`];
  const resultEnvelope: ResultEnvelope = {
    summary: `${label}: refused (${code}) — ${reason}`,
    findings: [],
    evidence
  };
  return {
    schemaVersion: 1,
    status: "refused",
    result: resultEnvelope,
    evidence,
    provenance: {
      schemaVersion: 1,
      backendId: descriptor.id,
      locality: descriptor.locality,
      kind: descriptor.kind,
      attestation,
      handle: attestation.handle
    }
  };
}

// ---------------------------------------------------------------------------
// The ExecutionBackend interface + driver registry.
// ---------------------------------------------------------------------------

export function createExecutionBackend(id: string): ExecutionBackend {
  const descriptor = getBackendDescriptor(id);
  return {
    descriptor,
    probe: (context) => probeBackend(id, context),
    run: (request) => runBackend({ ...request, backendId: id })
  };
}

// ---- inspection payloads (shared by CLI + MCP via the orchestrator) --------

export function backendListPayload(): {
  schemaVersion: 1;
  default: string;
  backends: BackendDescriptor[];
} {
  return { schemaVersion: 1, default: DEFAULT_BACKEND_ID, backends: listBackendDescriptors() };
}

export function backendShowPayload(id: string): BackendDescriptor {
  return getBackendDescriptor(id);
}

export function backendProbePayload(
  id: string | undefined,
  context: { cwd?: string } = {}
): BackendProbeResult | { schemaVersion: 1; default: string; probes: BackendProbeResult[] } {
  if (id && id.trim()) return cachedProbeBackend(id.trim(), context);
  return { schemaVersion: 1, default: DEFAULT_BACKEND_ID, probes: backendIds().map((backendId) => cachedProbeBackend(backendId, context)) };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

export function buildChildEnv(policy: ResolvedSandboxPolicy): NodeJS.ProcessEnv {
  if (policy.env.inherit) return { ...process.env };
  // A minimal base so the interpreter resolves; everything else is filtered per
  // the env policy. PATH is always provided; HOME is included for tool resolution.
  const env: NodeJS.ProcessEnv = {};
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  if (process.env.HOME !== undefined) env.HOME = process.env.HOME;
  for (const name of policy.env.expose || []) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const name of policy.env.deny || []) {
    delete env[name];
  }
  return env;
}

function commandDenied(policy: ResolvedSandboxPolicy, command: string): string | undefined {
  const normalized = command.trim();
  if (!normalized) return "empty command";
  if (policy.execute.mode === "none") {
    return `command execution is denied by sandbox profile ${policy.id}`;
  }
  if (policy.execute.mode === "allowlist" && !(policy.execute.allow || []).includes(normalized)) {
    return `command is outside sandbox profile ${policy.id} allowlist`;
  }
  return undefined;
}

function runtimeNote(descriptor: BackendDescriptor): string {
  return getBackendDriver(descriptor.id)?.runtimeNote?.() ?? "node";
}

// ---- Probe cache (v0.1.60) — mechanism, not policy -----------------------
const _probeCache = new Map<string, { result: ReturnType<typeof probeBackend>; at: number }>();
const PROBE_CACHE_TTL_MS = (() => {
  const raw = process.env.CW_PROBE_CACHE_TTL_MS;
  const n = raw ? parseInt(raw, 10) : 60_000;
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
})(); // default 60s; set CW_PROBE_CACHE_TTL_MS=0 to disable

function cachedProbeBackend(id: string, context: { cwd?: string }): ReturnType<typeof probeBackend> {
  const key = `${id}:${context.cwd || ''}`;
  const cached = _probeCache.get(key);
  if (cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS) return cached.result;
  const result = probeBackend(id, context);
  _probeCache.set(key, { result, at: Date.now() });
  return result;
}

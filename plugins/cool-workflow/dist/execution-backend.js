"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendError = exports.SANDBOX_DIMENSIONS = exports.DEFAULT_BACKEND_ID = exports.EXECUTION_BACKEND_SCHEMA_VERSION = void 0;
exports.registerBackend = registerBackend;
exports.getBackendDriver = getBackendDriver;
exports.listBackendDescriptors = listBackendDescriptors;
exports.backendIds = backendIds;
exports.isBackendId = isBackendId;
exports.getBackendDescriptor = getBackendDescriptor;
exports.resolveBackendSelection = resolveBackendSelection;
exports.backendSelectionFrom = backendSelectionFrom;
exports.requiredSandboxDimensions = requiredSandboxDimensions;
exports.attestSandbox = attestSandbox;
exports.probeBackend = probeBackend;
exports.runBackend = runBackend;
exports.stripSecretArgs = stripSecretArgs;
exports.prepareAgentSpawn = prepareAgentSpawn;
exports.runAgentBatchOutcomes = runAgentBatchOutcomes;
exports.createExecutionBackend = createExecutionBackend;
exports.listExecutionBackends = listExecutionBackends;
exports.backendListPayload = backendListPayload;
exports.backendShowPayload = backendShowPayload;
exports.backendProbePayload = backendProbePayload;
exports.buildChildEnv = buildChildEnv;
exports.sha256 = sha256;
exports.clearProbeCache = clearProbeCache;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
exports.EXECUTION_BACKEND_SCHEMA_VERSION = 1;
exports.DEFAULT_BACKEND_ID = "node";
exports.SANDBOX_DIMENSIONS = ["read", "write", "command", "network", "env"];
class BackendError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "BackendError";
        this.code = code;
        this.details = details;
    }
}
exports.BackendError = BackendError;
const DRIVER_SPECS = [
    {
        id: "node",
        title: "Node (default)",
        description: "Default backend. Reproduces pre-v0.1.29 behavior exactly: the host runs the worker in-process under CW's worker-output acceptance. When executing a command it enforces the command + env policy via the Node child process and attests OS read/write/network isolation to the host.",
        kind: "local",
        locality: "local",
        default: true,
        readiness: "ready",
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" }
    },
    {
        id: "bun",
        title: "Bun",
        description: "Bun-friendly backend. Node-compatible by default: it executes via the Node-compatible runtime so evidence is byte-stable with the node backend, and attests Bun availability in provenance. Enforces command + env via the child process; attests read/write/network to the host.",
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
        description: "Runs a command/worker via the system shell (/bin/sh -c) under the sandbox contract. Enforces command + env via the child process; attests read/write/network to the host.",
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
        description: "Delegates execution to a container runtime (docker/podman) and records the image@digest handle + attestation + result. A container can enforce all five dimensions via mounts, dropped capabilities, a network namespace, and a filtered env. Fails closed when no image is supplied or no runtime is present.",
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
        description: "Delegates execution to a remote runner and records the endpoint + job handle + attestation + result. Enforces command + env at the remote; attests read/write/network. Fails closed when no endpoint is configured.",
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
        description: "Delegates execution to a CI runner and records the job handle + attestation + result. Enforces command + env in the CI job; attests read/write/network. Fails closed when no CI job target is configured.",
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
        description: "Delegates each worker to an EXTERNAL agent process (claude -p / codex exec / an HTTP agent endpoint) and records the agent CHILD's command + exit + stdout digest as the canonical evidence triple, plus a kind:process handle and the agent-reported model + prompt/result digests as provenance. The MODEL runs in the agent's process, NEVER in CW — CW imports no model SDK and holds no API key; it spawns an out-of-process child argv-style (shell:false) or POSTs to a configured endpoint. CW enforces only the exact argv it spawns; the agent host attests read/write/network/env. Fails closed when no command-template/endpoint is configured, on non-zero exit, or on a missing/invalid result.md.",
        kind: "delegating",
        locality: "local",
        default: false,
        delegate: "agent-process",
        readiness: "unverified",
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "attest" }
    }
];
function specCapabilities(spec) {
    return exports.SANDBOX_DIMENSIONS.map((dimension) => ({ dimension, support: spec.support[dimension] }));
}
function specDescriptor(spec) {
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
const BACKEND_REGISTRY = new Map();
/** Register (or override) a backend driver. The public extension seam. */
function registerBackend(driver) {
    BACKEND_REGISTRY.set(driver.spec.id, driver);
}
function getBackendDriver(id) {
    return BACKEND_REGISTRY.get(id);
}
function registeredDrivers() {
    return [...BACKEND_REGISTRY.values()];
}
function listBackendDescriptors() {
    return registeredDrivers()
        .map((driver) => specDescriptor(driver.spec))
        .sort((left, right) => left.id.localeCompare(right.id));
}
function backendIds() {
    return registeredDrivers()
        .map((driver) => driver.spec.id)
        .sort();
}
function isBackendId(id) {
    return Boolean(id) && BACKEND_REGISTRY.has(id);
}
function getBackendDescriptor(id) {
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
const BUILTIN_DRIVER_BEHAVIORS = {
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
function ctxDelegate(impl) {
    return (ctx) => impl(ctx.descriptor, ctx.policy, ctx.request, ctx.label, ctx.handle, ctx.attestation);
}
// ---------------------------------------------------------------------------
// Selection & resolution. `--backend <id>` (flag) > CW_BACKEND (env) > default.
// ---------------------------------------------------------------------------
function resolveBackendSelection(requested, env = process.env) {
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
    return { backendId: exports.DEFAULT_BACKEND_ID, source: "default" };
}
function backendSelectionFrom(args, env = process.env) {
    const requested = firstString(args.backend, args.backendId, args.executionBackend);
    return resolveBackendSelection(requested, env);
}
// ---------------------------------------------------------------------------
// Sandbox dimension mapping + attestation. The sandbox profile is the contract.
// ---------------------------------------------------------------------------
/** The dimensions a resolved profile requires to be restricted. */
function requiredSandboxDimensions(policy) {
    const required = [];
    // read/write are always bounded for a resolved CW policy (path allowlist +
    // worker-output acceptance), so they are always required.
    required.push("read");
    required.push("write");
    if (policy.execute.mode !== "any")
        required.push("command");
    if (policy.network.mode !== "any")
        required.push("network");
    if (policy.env.inherit === false)
        required.push("env");
    return required;
}
function attestSandbox(descriptor, policy, options = { mode: "execute" }) {
    const required = requiredSandboxDimensions(policy);
    const supportByDimension = new Map(descriptor.capabilities.map((cap) => [cap.dimension, cap.support]));
    const enforced = [];
    const attested = [];
    const unenforceable = [];
    for (const dimension of required) {
        const declared = supportByDimension.get(dimension) || "unsupported";
        let effective = declared;
        if (options.mode === "delegate-host" && declared !== "unsupported") {
            // The host runs the worker; CW enforces only worker-output acceptance
            // (write). Everything else is attested to the host.
            effective = dimension === "write" ? "enforce" : "attest";
        }
        if (effective === "enforce")
            enforced.push(dimension);
        else if (effective === "attest")
            attested.push(dimension);
        else
            unenforceable.push(dimension);
    }
    const refusedForReadiness = options.ready === false;
    const status = unenforceable.length || refusedForReadiness ? "refused" : enforced.length ? "enforced" : "attested";
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
function probeBackend(id, context = {}) {
    const descriptor = getBackendDescriptor(id);
    const driver = BACKEND_REGISTRY.get(id);
    // The driver owns its readiness checks; probeBackend just wraps them with the
    // descriptor-derived envelope. A driver with no probe is unverified by default.
    const body = driver?.probe
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
function probeNodeBackend() {
    const ok = hasExecutable("node");
    return {
        checks: [{ name: "node-runtime", ok, detail: ok ? "node on PATH" : "node not found on PATH" }],
        readiness: ok ? "ready" : "unavailable",
        reason: ok ? undefined : "node runtime not found on PATH"
    };
}
function probeShellBackend() {
    const ok = hasExecutable("sh") || node_fs_1.default.existsSync("/bin/sh");
    return {
        checks: [{ name: "posix-shell", ok, detail: ok ? "sh available" : "no POSIX shell found" }],
        readiness: ok ? "ready" : "unavailable",
        reason: ok ? undefined : "POSIX shell not found"
    };
}
function probeBunBackend() {
    const bun = hasExecutable("bun");
    const node = hasExecutable("node");
    return {
        checks: [
            { name: "bun-runtime", ok: bun, detail: bun ? "bun on PATH" : "bun not found; node-compatible fallback" },
            { name: "node-compatible-fallback", ok: node, detail: node ? "node on PATH" : "node not found on PATH" }
        ],
        readiness: bun || node ? "ready" : "unavailable",
        reason: !bun && node ? "bun not installed; executing via node-compatible runtime" : !bun && !node ? "neither bun nor node found on PATH" : undefined
    };
}
function probeContainerBackend() {
    const docker = hasExecutable("docker");
    const podman = hasExecutable("podman");
    return {
        checks: [
            { name: "docker", ok: docker, detail: docker ? "docker on PATH" : "docker not found" },
            { name: "podman", ok: podman, detail: podman ? "podman on PATH" : "podman not found" }
        ],
        readiness: docker || podman ? "ready" : "unavailable",
        reason: docker || podman ? undefined : "no container runtime (docker/podman) found; supply --image to delegate explicitly"
    };
}
function probeRemoteBackend() {
    const endpoint = (process.env.CW_REMOTE_ENDPOINT || "").trim();
    return {
        checks: [{ name: "endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_REMOTE_ENDPOINT configured" : "CW_REMOTE_ENDPOINT not set" }],
        readiness: endpoint ? "ready" : "unverified",
        reason: endpoint ? undefined : "no remote endpoint configured (set CW_REMOTE_ENDPOINT or pass --endpoint)"
    };
}
function probeCiBackend() {
    const endpoint = (process.env.CW_CI_ENDPOINT || "").trim();
    return {
        checks: [{ name: "ci-endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_CI_ENDPOINT configured" : "CW_CI_ENDPOINT not set" }],
        readiness: endpoint ? "ready" : "unverified",
        reason: endpoint ? undefined : "no CI job target configured (set CW_CI_ENDPOINT or pass --job)"
    };
}
function probeAgentBackend() {
    // Mirrors remote/ci EXACTLY: unconfigured ⇒ `unverified` (NOT a hard refusal),
    // configured ⇒ `ready`. "Configured" = a command-template or endpoint is set.
    const command = (process.env.CW_AGENT_COMMAND || "").trim();
    const endpoint = (process.env.CW_AGENT_ENDPOINT || "").trim();
    const configured = Boolean(command || endpoint);
    return {
        checks: [
            { name: "agent-command", ok: Boolean(command), detail: command ? "CW_AGENT_COMMAND configured" : "CW_AGENT_COMMAND not set" },
            { name: "agent-endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_AGENT_ENDPOINT configured" : "CW_AGENT_ENDPOINT not set" }
        ],
        readiness: configured ? "ready" : "unverified",
        reason: configured ? undefined : "no agent configured (set CW_AGENT_COMMAND or CW_AGENT_ENDPOINT, or pass --agent-command/--agent-endpoint)"
    };
}
// ---------------------------------------------------------------------------
// The run entry. Refuses (fail closed) when the sandbox cannot be honored, the
// command is denied by policy, or the backend is not ready. Local drivers spawn a
// thin child process; delegating drivers record a handle and never execute here.
// ---------------------------------------------------------------------------
function runBackend(request) {
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
        return refusedEnvelope(descriptor, policy, label, "sandbox-unenforceable", `Backend ${descriptor.id} cannot enforce or attest required sandbox dimension(s): ${attestation.unenforceable.join(", ")}`, { ready: probe.ready, attestation });
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
function executeLocal(descriptor, policy, request, label, attestation) {
    const command = String(request.command);
    const args = (request.args || []).map(String);
    const env = buildChildEnv(policy);
    const options = {
        cwd: request.cwd,
        env,
        encoding: "utf8",
        timeout: request.timeoutMs,
        maxBuffer: 32 * 1024 * 1024
    };
    // shell backend runs via /bin/sh -c; node/bun run the command directly
    // (bun is Node-compatible by default so evidence stays byte-stable with node).
    // spawnStyle comes from the registered driver, not a hardcoded id check.
    const result = getBackendDriver(descriptor.id)?.spawnStyle === "shell"
        ? (0, node_child_process_1.spawnSync)([command, ...args].join(" "), { ...options, shell: true })
        : (0, node_child_process_1.spawnSync)(command, args, { ...options, shell: false });
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
    const summary = status === "completed"
        ? `${label}: completed (exit 0)`
        : spawnError
            ? `${label}: failed (${spawnError})`
            : `${label}: failed (exit ${exitCode})`;
    const resultEnvelope = { summary, findings: [], evidence };
    const notes = [`runtime: ${runtimeNote(descriptor)}`];
    if (spawnError)
        notes.push(`spawn-error: ${spawnError}`);
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
function delegate(descriptor, policy, request, label, probe) {
    const handle = delegationHandle(descriptor, request);
    if (!handle) {
        return refusedEnvelope(descriptor, policy, label, "delegation-target-missing", probe.reason || `Backend ${descriptor.id} has no delegation target; refusing rather than running unsandboxed`, { ready: probe.ready });
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
function delegatedEnvelope(descriptor, label, handle, attestation, command, args, exitCode, stdout) {
    const digest = sha256(stdout);
    const status = exitCode === 0 ? "completed" : "failed";
    const evidence = [
        `command:${[command, ...args].join(" ")}`,
        `exitCode:${exitCode === null ? "null" : exitCode}`,
        `stdoutSha256:${digest}`
    ];
    const summary = status === "completed" ? `${label}: completed (exit 0)` : `${label}: failed (exit ${exitCode === null ? "null" : exitCode})`;
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
function runContainer(descriptor, policy, request, label, handle, attestation) {
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
    const ping = (0, node_child_process_1.spawnSync)(runtime, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 15000 });
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
    if (policy.network.mode !== "any")
        runArgs.push("--network", "none");
    // read/write: mount the workspace read-only at the same path; CW's own
    // worker-output acceptance still bounds writes. (Write-through mounts can be a
    // later refinement; read-only is the safe default.)
    runArgs.push("-v", `${cwd}:${cwd}:ro`, "-w", cwd);
    // env: only the explicitly exposed names cross into the container — the image
    // provides its own PATH/HOME, so we never inject host-specific base env.
    if (policy.env.inherit || (policy.env.expose && policy.env.expose.length)) {
        for (const name of policy.env.inherit ? Object.keys(process.env) : policy.env.expose || []) {
            if (name === "PATH" || name === "HOME")
                continue;
            const value = process.env[name];
            if (value !== undefined)
                runArgs.push("-e", `${name}=${value}`);
        }
    }
    runArgs.push(handle.ref, command, ...args);
    const result = (0, node_child_process_1.spawnSync)(runtime, runArgs, {
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
// A self-contained Node child that performs the remote/CI delegation: it reads a
// JSON job on stdin, POSTs it to the endpoint, optionally polls a returned jobId,
// and prints `{ exitCode, stdout }` (or `{ error }`) on stdout. Node-only (global
// fetch, node >=18), so the driver stays portable and synchronous from CW's view.
const HTTP_DELEGATE_CHILD = `
(async () => {
  const read = () => new Promise((res) => { let b = ""; process.stdin.on("data", (c) => (b += c)); process.stdin.on("end", () => res(b)); });
  try {
    const job = JSON.parse((await read()) || "{}");
    const endpoint = process.env.CW_DELEGATE_ENDPOINT;
    if (!endpoint) throw new Error("no endpoint");
    const post = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job) });
    if (!post.ok) throw new Error("runner responded " + post.status);
    let data = await post.json();
    // Poll a returned jobId until the runner reports done.
    let guard = 0;
    while (data && data.jobId && data.done !== true && guard++ < 600) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await fetch(endpoint + (endpoint.includes("?") ? "&" : "?") + "jobId=" + encodeURIComponent(data.jobId));
      if (!poll.ok) throw new Error("poll responded " + poll.status);
      data = await poll.json();
    }
    if (typeof data.exitCode !== "number") throw new Error("runner did not report an exitCode");
    process.stdout.write(JSON.stringify({ exitCode: data.exitCode, stdout: String(data.stdout || "") }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e && e.message ? e.message : String(e) }));
  }
})();
`;
/** remote / ci — real HTTP delegation. POSTs the job to the configured endpoint
 *  (and polls a returned jobId) via a Node child, then records the runner's exit +
 *  stdout digest as canonical evidence. Fails closed when the endpoint is missing,
 *  unreachable, errors, or returns no exitCode. Untestable without a live runner,
 *  but the refusal paths are exercised by the smoke. */
function runHttpDelegation(descriptor, policy, request, label, handle, attestation) {
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
    const child = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", HTTP_DELEGATE_CHILD], {
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
    let parsed;
    try {
        parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
    }
    catch {
        return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${descriptor.id} runner returned an unparseable response`, {
            attestation
        });
    }
    if (parsed.error || typeof parsed.exitCode !== "number") {
        return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${descriptor.id} runner error: ${parsed.error || "no exitCode reported"}`, { attestation });
    }
    return delegatedEnvelope(descriptor, label, handle, attestation, command, args, parsed.exitCode, String(parsed.stdout || ""));
}
/** Resolve the agent invocation from the request delegation > env. Vendor-neutral;
 *  the durable file config is folded in by the drive layer before this point. */
function resolveAgentInvocation(request) {
    const delegation = request.delegation || {};
    const envCommand = (process.env.CW_AGENT_COMMAND || "").trim();
    const endpoint = delegation.endpoint || (process.env.CW_AGENT_ENDPOINT || "").trim() || undefined;
    const model = delegation.model || (process.env.CW_AGENT_MODEL || "").trim() || undefined;
    // Accept the invocation via delegation (preferred) OR the top-level command/args.
    let binary = delegation.command || request.command || undefined;
    let rawArgs = delegation.args ? [...delegation.args] : request.args ? [...request.args] : [];
    // An env-string command ("claude -p --output-format json {{manifest}}") is split
    // into a binary + discrete argv template — NEVER shell-interpreted.
    if (!binary && envCommand) {
        const parts = envCommand.split(/\s+/).filter(Boolean);
        binary = parts[0];
        if (!delegation.args)
            rawArgs = parts.slice(1);
    }
    else if (binary && !delegation.args && /\s/.test(binary)) {
        const parts = binary.split(/\s+/).filter(Boolean);
        binary = parts[0];
        rawArgs = parts.slice(1);
    }
    return { binary, rawArgs, endpoint, model, timeoutMs: request.timeoutMs };
}
const AGENT_SECRET_FLAGS = new Set(["--api-key", "--apikey", "--token", "--key", "--secret", "--password", "--auth", "--bearer"]);
/** Redact secrets from recorded agent args: a value FOLLOWING a known secret flag,
 *  an `--x-key=...` inline value, or a token that LOOKS like a credential. Never
 *  record a raw secret in provenance/evidence. Exported so the durable config
 *  surface strips the SAME way before persisting/showing a command template. */
function stripSecretArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = String(args[i]);
        if (AGENT_SECRET_FLAGS.has(arg.toLowerCase())) {
            out.push(arg);
            if (i + 1 < args.length) {
                out.push("<redacted>");
                i++;
            }
            continue;
        }
        const inline = arg.match(/^(--?[A-Za-z][\w-]*(?:key|token|secret|password|auth|bearer)[\w-]*)=.*/i);
        if (inline) {
            out.push(`${inline[1]}=<redacted>`);
            continue;
        }
        // Bare credential-looking token: a known provider prefix, or a long high-entropy
        // run with NO path separators (so file paths / {{...}} substitutions survive as
        // useful provenance). Over-redaction is safe; leaking a key is not.
        if (/^(sk-|ghp_|gho_|github_pat_|xox[abpr]-|Bearer\s)/.test(arg) || (arg.length >= 32 && /^[A-Za-z0-9_\-]{32,}$/.test(arg))) {
            out.push("<redacted>");
            continue;
        }
        out.push(arg);
    }
    return out;
}
/** Best-effort parse of the AGENT-reported model id from its stdout. SOLELY the
 *  agent's own report — `unreported` when absent. Never CW_AGENT_MODEL. */
function parseAgentReport(stdout) {
    const text = String(stdout || "").trim();
    if (!text)
        return {};
    const tryObj = (value) => {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    };
    let obj = tryObj(text);
    if (!obj) {
        const line = text
            .split(/\r?\n/)
            .reverse()
            .find((entry) => entry.trim().startsWith("{") && entry.trim().endsWith("}"));
        if (line)
            obj = tryObj(line.trim());
    }
    if (!obj)
        return {};
    const usage = obj.usage && typeof obj.usage === "object" ? obj.usage : undefined;
    let model = typeof obj.model === "string"
        ? obj.model
        : usage && typeof usage.model === "string"
            ? usage.model
            : typeof obj.modelId === "string"
                ? obj.modelId
                : undefined;
    // Some agents (e.g. `claude -p --output-format json`) report no top-level model;
    // the model id(s) appear as KEYS of a `modelUsage` object. Pick the primary model
    // (the one with the most input tokens). Still SOLELY the agent's own report.
    if (!model && obj.modelUsage && typeof obj.modelUsage === "object" && !Array.isArray(obj.modelUsage)) {
        const entries = Object.entries(obj.modelUsage);
        if (entries.length) {
            const tokensOf = (value) => {
                const record = value && typeof value === "object" ? value : {};
                const input = Number(record.inputTokens ?? record.input_tokens ?? 0);
                return Number.isFinite(input) ? input : 0;
            };
            entries.sort((left, right) => tokensOf(right[1]) - tokensOf(left[1]));
            model = entries[0][0];
        }
    }
    // Track 1: the executor's detached signature over its usage report, if it signs.
    // SOLELY the agent's own field — CW verifies it later against the trust key.
    const usageSignature = typeof obj.usageSignature === "string"
        ? obj.usageSignature
        : typeof obj.usage_signature === "string"
            ? obj.usage_signature
            : undefined;
    return { model, usage, usageSignature };
}
function agentSubstitutions(request, model) {
    const manifest = request.manifest;
    const workerDir = manifest?.workerDir || request.cwd || "";
    return {
        manifest: manifest?.manifestPath || (workerDir ? node_path_1.default.join(workerDir, "manifest.json") : ""),
        input: manifest?.inputPath || "",
        result: manifest?.resultPath || "",
        workerDir,
        model: model || "",
        prompt: manifest?.prompt || ""
    };
}
function substituteAgentArg(arg, subst) {
    return arg.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in subst ? subst[key] : `{{${key}}}`));
}
/** Build the recorded process handle for the envelope — secret-stripped + the
 *  agent-reported model. Same SHAPE that lands in provenance, never in evidence. */
function recordedAgentHandle(binary, endpoint, recordedArgs, model, reportedModel, reportedUsage, usageSignature) {
    const ref = binary ? [binary, ...recordedArgs].join(" ") : endpoint || "";
    return {
        kind: "process",
        ref,
        endpoint,
        metadata: {
            mode: binary ? "command" : "endpoint",
            command: binary,
            args: recordedArgs,
            model,
            reportedModel,
            // Telemetry thread-back: the agent's OWN self-reported token usage (parsed
            // from its stdout by parseAgentReport). ATTESTED, never measured by CW —
            // same red-line posture as reportedModel. Lands in provenance, never in the
            // byte-stable evidence triple. Absent when the agent reported no usage.
            ...(reportedUsage ? { reportedUsage } : {}),
            // Track 1: the executor's detached signature over its usage report. CW
            // verifies it against the operator trust key at output intake.
            ...(usageSignature ? { usageSignature } : {})
        }
    };
}
function runAgentProcess(descriptor, policy, request, label, handle, attestation) {
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
        let outcome;
        if (request.preparedAgentOutcome) {
            outcome = request.preparedAgentOutcome;
        }
        else {
            // Live output is opt-in (POLA): stdout is always captured as data, while
            // stderr is forwarded only when the operator explicitly asks for a stream
            // and this process is attached to a terminal. CI/pipes stay silent.
            const streamStderr = process.env.CW_AGENT_STREAM === "1" && Boolean(process.stderr.isTTY) && process.env.CW_NO_STREAM !== "1";
            const child = (0, node_child_process_1.spawnSync)(resolved.binary, realArgs, {
                cwd: request.cwd,
                env: { ...process.env },
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
/** Resolve a request to a spawn-style batch job, or undefined when the agent is
 *  endpoint-configured/unconfigured (those settle through the serial path). */
function prepareAgentSpawn(request) {
    const resolved = resolveAgentInvocation(request);
    if (!resolved.binary)
        return undefined;
    const subst = agentSubstitutions(request, resolved.model);
    return {
        binary: resolved.binary,
        args: resolved.rawArgs.map((arg) => substituteAgentArg(arg, subst)),
        cwd: request.cwd,
        timeoutMs: resolved.timeoutMs || 600000
    };
}
// Reads jobs JSON on stdin, spawns ALL concurrently (shell:false, inherited env —
// the agent's own credentials resolve; CW never reads them), per-job SIGTERM at
// timeoutMs + SIGKILL at +5s, caps each captured stdout at 32MB, and prints the
// outcome array when every job has settled. stderr is drained (a full pipe must
// never wedge a child). A kill yields exitCode null — the no-exit-code refusal.
const BATCH_DELEGATE_CHILD = `
const { spawn } = require("node:child_process");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const jobs = JSON.parse(raw);
  if (!jobs.length) { process.stdout.write("[]"); return; }
  const out = new Array(jobs.length);
  let pending = jobs.length;
  const CAP = 32 * 1024 * 1024;
  jobs.forEach((job, i) => {
    let stdout = "";
    let settled = false;
    const settle = (o) => {
      if (settled) return;
      settled = true;
      out[i] = o;
      if (--pending === 0) process.stdout.write(JSON.stringify(out));
    };
    let child;
    try {
      child = spawn(job.binary, job.args, { cwd: job.cwd, env: process.env, shell: false });
    } catch (error) {
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout: "" });
      return;
    }
    const term = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} }, job.timeoutMs);
    const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, job.timeoutMs + 5000);
    child.stdout.on("data", (d) => { if (stdout.length < CAP) stdout += d; });
    child.stderr.on("data", () => {});
    child.on("error", (error) => {
      clearTimeout(term); clearTimeout(kill);
      settle({ spawnError: String((error && error.message) || error), exitCode: null, stdout });
    });
    child.on("close", (code) => {
      clearTimeout(term); clearTimeout(kill);
      settle({ exitCode: typeof code === "number" ? code : null, stdout });
    });
  });
});
`;
/** Run a batch of agent spawns concurrently; outcomes index-align with jobs. The
 *  parent backstop timeout (max job timeout + 30s) means even a wedged delegate
 *  child cannot deadlock the drive: on any batch-level failure EVERY job settles
 *  as a fail-closed spawn refusal — never a fabricated completion, never a hang. */
function runAgentBatchOutcomes(jobs) {
    if (!jobs.length)
        return [];
    const maxTimeout = Math.max(...jobs.map((job) => job.timeoutMs));
    const child = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", BATCH_DELEGATE_CHILD], {
        input: JSON.stringify(jobs),
        encoding: "utf8",
        maxBuffer: 33 * 1024 * 1024 * jobs.length,
        timeout: maxTimeout + 30000
    });
    if (!child.error && typeof child.status === "number" && child.status === 0) {
        try {
            const parsed = JSON.parse(String(child.stdout || ""));
            if (Array.isArray(parsed) && parsed.length === jobs.length)
                return parsed;
        }
        catch {
            // fall through to the fail-closed mapping below
        }
    }
    const reason = child.error ? messageOf(child.error) : `batch delegate exited ${child.status === null ? "without an exit code (timed out or killed)" : `with ${child.status}`}`;
    return jobs.map(() => ({ spawnError: `batch delegate failed: ${reason}`, exitCode: null, stdout: "" }));
}
/** Agent HTTP endpoint variant — POSTs the worker manifest/prompt to a configured
 *  agent endpoint via the shared Node delegate child; if the endpoint returns a
 *  `result` body, CW writes it to the worker's result.md (the endpoint agent is the
 *  producer — CW is only transport). Evidence triple = the delegate child's
 *  exit + stdout digest, identical mechanism to runHttpDelegation. Fails closed. */
function runAgentEndpoint(descriptor, policy, request, label, resolved, attestation) {
    const endpoint = resolved.endpoint;
    const manifest = request.manifest;
    const job = JSON.stringify({
        manifest,
        prompt: manifest?.prompt,
        model: resolved.model,
        resultPath: manifest?.resultPath,
        sandboxProfileId: policy.id
    });
    const child = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", HTTP_DELEGATE_CHILD], {
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
    let parsed;
    try {
        parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
    }
    catch {
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
        if (body && !node_fs_1.default.existsSync(manifest.resultPath)) {
            try {
                node_fs_1.default.writeFileSync(manifest.resultPath, body, "utf8");
            }
            catch {
                /* the accept layer will fail closed on a missing result.md */
            }
        }
    }
    const reportedModel = report.model && report.model.trim() ? report.model.trim() : "unreported";
    const handleOut = recordedAgentHandle(undefined, endpoint, [], resolved.model, reportedModel, report.usage, report.usageSignature);
    return delegatedEnvelope(descriptor, label, handleOut, { ...attestation, handle: handleOut }, "agent-endpoint", [endpoint], parsed.exitCode, stdout);
}
function extractEndpointResult(stdout) {
    const text = String(stdout || "").trim();
    if (!text)
        return undefined;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
            if (typeof parsed.result === "string")
                return parsed.result;
            if (typeof parsed.resultMarkdown === "string")
                return parsed.resultMarkdown;
        }
    }
    catch {
        /* not JSON — treat the raw text as the result body */
        return text;
    }
    return undefined;
}
function delegationHandle(descriptor, request) {
    return getBackendDriver(descriptor.id)?.buildHandle?.(request);
}
function containerHandle(request) {
    const delegation = request.delegation || {};
    const image = delegation.image || (process.env.CW_CONTAINER_IMAGE || "").trim() || undefined;
    if (!image)
        return undefined;
    const digest = delegation.digest || (process.env.CW_CONTAINER_DIGEST || "").trim() || undefined;
    const ref = digest ? `${image}@${digest}` : image;
    return { kind: "container", ref, image, digest };
}
function remoteHandle(request) {
    const delegation = request.delegation || {};
    const endpoint = delegation.endpoint || (process.env.CW_REMOTE_ENDPOINT || "").trim() || undefined;
    if (!endpoint)
        return undefined;
    const jobId = delegation.jobId || (process.env.CW_REMOTE_JOB || "").trim() || undefined;
    const ref = jobId ? `${endpoint}#${jobId}` : endpoint;
    return { kind: "remote", ref, endpoint, jobId };
}
function ciHandle(request) {
    const delegation = request.delegation || {};
    const endpoint = delegation.endpoint || (process.env.CW_CI_ENDPOINT || "").trim() || undefined;
    const jobId = delegation.jobId || (process.env.CW_CI_JOB || "").trim() || undefined;
    if (!endpoint && !jobId)
        return undefined;
    const ref = endpoint && jobId ? `${endpoint}#${jobId}` : jobId || endpoint || "";
    return { kind: "ci", ref, endpoint, jobId };
}
function agentHandle(request) {
    // The agent invocation is POLICY-as-DATA, resolved flags(delegation) > env. The
    // handle records ONLY secret-stripped provenance; the raw template is re-resolved
    // inside runAgentProcess for substitution + spawning so no secret ever lands in
    // a recorded handle/evidence entry.
    const resolved = resolveAgentInvocation(request);
    if (!resolved.binary && !resolved.endpoint)
        return undefined;
    const strippedArgs = stripSecretArgs(resolved.rawArgs);
    const ref = resolved.binary ? [resolved.binary, ...strippedArgs].join(" ") : resolved.endpoint || "";
    return {
        kind: "process",
        ref,
        endpoint: resolved.endpoint,
        metadata: {
            mode: resolved.binary ? "command" : "endpoint",
            command: resolved.binary,
            args: strippedArgs,
            model: resolved.model
        }
    };
}
function refusedEnvelope(descriptor, policy, label, code, reason, options = {}) {
    const attestation = options.attestation
        ? { ...options.attestation, status: "refused", notes: [...(options.attestation.notes || []), `refused: ${code}`] }
        : { ...attestSandbox(descriptor, policy, { mode: "execute", ready: options.ready }), status: "refused", notes: [`refused: ${code}`] };
    const evidence = [`refused:${code}`, `backend:${descriptor.id}`, `sandbox:${policy.id}`];
    const resultEnvelope = {
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
function createExecutionBackend(id) {
    const descriptor = getBackendDescriptor(id);
    return {
        descriptor,
        probe: (context) => probeBackend(id, context),
        run: (request) => runBackend({ ...request, backendId: id })
    };
}
function listExecutionBackends() {
    return backendIds().map(createExecutionBackend);
}
// ---- inspection payloads (shared by CLI + MCP via the orchestrator) --------
function backendListPayload() {
    return { schemaVersion: 1, default: exports.DEFAULT_BACKEND_ID, backends: listBackendDescriptors() };
}
function backendShowPayload(id) {
    return getBackendDescriptor(id);
}
function backendProbePayload(id, context = {}) {
    if (id && id.trim())
        return cachedProbeBackend(id.trim(), context);
    return { schemaVersion: 1, default: exports.DEFAULT_BACKEND_ID, probes: backendIds().map((backendId) => cachedProbeBackend(backendId, context)) };
}
// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function buildChildEnv(policy) {
    if (policy.env.inherit)
        return { ...process.env };
    // A minimal base so the interpreter resolves; everything else is filtered per
    // the env policy. PATH is always provided; HOME is included for tool resolution.
    const env = {};
    if (process.env.PATH !== undefined)
        env.PATH = process.env.PATH;
    if (process.env.HOME !== undefined)
        env.HOME = process.env.HOME;
    for (const name of policy.env.expose || []) {
        if (process.env[name] !== undefined)
            env[name] = process.env[name];
    }
    for (const name of policy.env.deny || []) {
        delete env[name];
    }
    return env;
}
function commandDenied(policy, command) {
    const normalized = command.trim();
    if (!normalized)
        return "empty command";
    if (policy.execute.mode === "none") {
        return `command execution is denied by sandbox profile ${policy.id}`;
    }
    if (policy.execute.mode === "allowlist" && !(policy.execute.allow || []).includes(normalized)) {
        return `command is outside sandbox profile ${policy.id} allowlist`;
    }
    return undefined;
}
function runtimeNote(descriptor) {
    return getBackendDriver(descriptor.id)?.runtimeNote?.() ?? "node";
}
function hasExecutable(name) {
    const dirs = (process.env.PATH || "").split(node_path_1.default.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = node_path_1.default.join(dir, name);
        try {
            if (node_fs_1.default.existsSync(candidate) && node_fs_1.default.statSync(candidate).isFile())
                return true;
        }
        catch {
            // ignore unreadable PATH entries
        }
    }
    return false;
}
function sha256(value) {
    return `sha256:${node_crypto_1.default.createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
// ---- Probe cache (v0.1.60) — mechanism, not policy -----------------------
const _probeCache = new Map();
const PROBE_CACHE_TTL_MS = 60_000; // 60s
function cachedProbeBackend(id, context) {
    const key = `${id}:${context.cwd || ''}`;
    const cached = _probeCache.get(key);
    if (cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS)
        return cached.result;
    const result = probeBackend(id, context);
    _probeCache.set(key, { result, at: Date.now() });
    return result;
}
function clearProbeCache() { _probeCache.clear(); }

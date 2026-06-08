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
exports.createExecutionBackend = createExecutionBackend;
exports.listExecutionBackends = listExecutionBackends;
exports.backendListPayload = backendListPayload;
exports.backendShowPayload = backendShowPayload;
exports.backendProbePayload = backendProbePayload;
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
function listBackendDescriptors() {
    return DRIVER_SPECS.map(specDescriptor).sort((left, right) => left.id.localeCompare(right.id));
}
function backendIds() {
    return DRIVER_SPECS.map((spec) => spec.id).sort();
}
function isBackendId(id) {
    return Boolean(id) && DRIVER_SPECS.some((spec) => spec.id === id);
}
function getBackendDescriptor(id) {
    const spec = DRIVER_SPECS.find((candidate) => candidate.id === id);
    if (!spec) {
        throw new BackendError("backend-not-found", `Execution backend not found: ${id}`, { backendId: id, available: backendIds() });
    }
    return specDescriptor(spec);
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
    const checks = [];
    let readiness = "unverified";
    let reason;
    void context;
    if (id === "node") {
        const ok = hasExecutable("node");
        checks.push({ name: "node-runtime", ok, detail: ok ? "node on PATH" : "node not found on PATH" });
        readiness = ok ? "ready" : "unavailable";
        if (!ok)
            reason = "node runtime not found on PATH";
    }
    else if (id === "shell") {
        const ok = hasExecutable("sh") || node_fs_1.default.existsSync("/bin/sh");
        checks.push({ name: "posix-shell", ok, detail: ok ? "sh available" : "no POSIX shell found" });
        readiness = ok ? "ready" : "unavailable";
        if (!ok)
            reason = "POSIX shell not found";
    }
    else if (id === "bun") {
        const bun = hasExecutable("bun");
        const node = hasExecutable("node");
        checks.push({ name: "bun-runtime", ok: bun, detail: bun ? "bun on PATH" : "bun not found; node-compatible fallback" });
        checks.push({ name: "node-compatible-fallback", ok: node, detail: node ? "node on PATH" : "node not found on PATH" });
        readiness = bun || node ? "ready" : "unavailable";
        if (!bun && node)
            reason = "bun not installed; executing via node-compatible runtime";
        if (!bun && !node)
            reason = "neither bun nor node found on PATH";
    }
    else if (id === "container") {
        const docker = hasExecutable("docker");
        const podman = hasExecutable("podman");
        checks.push({ name: "docker", ok: docker, detail: docker ? "docker on PATH" : "docker not found" });
        checks.push({ name: "podman", ok: podman, detail: podman ? "podman on PATH" : "podman not found" });
        readiness = docker || podman ? "ready" : "unavailable";
        if (!docker && !podman)
            reason = "no container runtime (docker/podman) found; supply --image to delegate explicitly";
    }
    else if (id === "remote") {
        const endpoint = (process.env.CW_REMOTE_ENDPOINT || "").trim();
        checks.push({ name: "endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_REMOTE_ENDPOINT configured" : "CW_REMOTE_ENDPOINT not set" });
        readiness = endpoint ? "ready" : "unverified";
        if (!endpoint)
            reason = "no remote endpoint configured (set CW_REMOTE_ENDPOINT or pass --endpoint)";
    }
    else if (id === "ci") {
        const endpoint = (process.env.CW_CI_ENDPOINT || "").trim();
        checks.push({ name: "ci-endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_CI_ENDPOINT configured" : "CW_CI_ENDPOINT not set" });
        readiness = endpoint ? "ready" : "unverified";
        if (!endpoint)
            reason = "no CI job target configured (set CW_CI_ENDPOINT or pass --job)";
    }
    return {
        schemaVersion: 1,
        backendId: descriptor.id,
        locality: descriptor.locality,
        kind: descriptor.kind,
        readiness,
        ready: readiness === "ready",
        enforces: descriptor.enforces,
        attests: descriptor.attests,
        checks,
        reason
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
    const result = descriptor.id === "shell"
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
            attestation: { ...attestation, status: status === "completed" ? attestation.status : attestation.status, notes }
        }
    };
}
function delegate(descriptor, policy, request, label, probe) {
    const handle = delegationHandle(descriptor, request);
    if (!handle) {
        return refusedEnvelope(descriptor, policy, label, "delegation-target-missing", probe.reason || `Backend ${descriptor.id} has no delegation target; refusing rather than running unsandboxed`, { ready: probe.ready });
    }
    const attestation = attestSandbox(descriptor, policy, {
        mode: "execute",
        ready: true,
        handle,
        notes: [`delegated: ${descriptor.id} -> ${handle.ref}`]
    });
    const evidence = [
        `command:${[request.command, ...(request.args || [])].filter(Boolean).join(" ")}`.trim(),
        `delegated:${descriptor.id}`,
        `handle:${handle.ref}`
    ];
    const resultEnvelope = {
        summary: `${label}: delegated to ${descriptor.id} runner (${handle.ref})`,
        findings: [],
        evidence
    };
    return {
        schemaVersion: 1,
        status: "completed",
        result: resultEnvelope,
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
function delegationHandle(descriptor, request) {
    const delegation = request.delegation || {};
    if (descriptor.id === "container") {
        const image = delegation.image || (process.env.CW_CONTAINER_IMAGE || "").trim() || undefined;
        if (!image)
            return undefined;
        const digest = delegation.digest || (process.env.CW_CONTAINER_DIGEST || "").trim() || undefined;
        const ref = digest ? `${image}@${digest}` : image;
        return { kind: "container", ref, image, digest };
    }
    if (descriptor.id === "remote") {
        const endpoint = delegation.endpoint || (process.env.CW_REMOTE_ENDPOINT || "").trim() || undefined;
        if (!endpoint)
            return undefined;
        const jobId = delegation.jobId || (process.env.CW_REMOTE_JOB || "").trim() || undefined;
        const ref = jobId ? `${endpoint}#${jobId}` : endpoint;
        return { kind: "remote", ref, endpoint, jobId };
    }
    if (descriptor.id === "ci") {
        const endpoint = delegation.endpoint || (process.env.CW_CI_ENDPOINT || "").trim() || undefined;
        const jobId = delegation.jobId || (process.env.CW_CI_JOB || "").trim() || undefined;
        if (!endpoint && !jobId)
            return undefined;
        const ref = endpoint && jobId ? `${endpoint}#${jobId}` : jobId || endpoint || "";
        return { kind: "ci", ref, endpoint, jobId };
    }
    return undefined;
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
        return probeBackend(id.trim(), context);
    return { schemaVersion: 1, default: exports.DEFAULT_BACKEND_ID, probes: backendIds().map((backendId) => probeBackend(backendId, context)) };
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
    if (descriptor.id === "bun")
        return hasExecutable("bun") ? "bun (node-compatible execution)" : "node-compatible (bun not installed)";
    if (descriptor.id === "shell")
        return "posix-shell";
    return "node";
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

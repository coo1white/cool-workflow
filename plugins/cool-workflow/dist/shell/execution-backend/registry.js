"use strict";
// shell/execution-backend/registry.ts — the 7-driver registry: DRIVER_SPECS,
// registerBackend, resolveBackendSelection, attestSandbox, probeBackend,
// runBackend, and the CLI-facing inspection payloads.
//
// MILESTONE 5 (v2/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts (the parts not carved into
// local.ts/container.ts/remote.ts/ci.ts/agent.ts/probes.ts).
//
// Evidence: SPEC/execution-backend.md "The driver registry".
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasExecutable = exports.BackendError = exports.SANDBOX_DIMENSIONS = exports.DEFAULT_BACKEND_ID = exports.EXECUTION_BACKEND_SCHEMA_VERSION = void 0;
exports.registerBackend = registerBackend;
exports.getBackendDriver = getBackendDriver;
exports.listBackendDescriptors = listBackendDescriptors;
exports.backendIds = backendIds;
exports.isBackendId = isBackendId;
exports.getBackendDescriptor = getBackendDescriptor;
exports.resolveBackendSelection = resolveBackendSelection;
exports.requiredSandboxDimensions = requiredSandboxDimensions;
exports.attestSandbox = attestSandbox;
exports.probeBackend = probeBackend;
exports.runBackend = runBackend;
exports.createExecutionBackend = createExecutionBackend;
exports.backendListPayload = backendListPayload;
exports.backendShowPayload = backendShowPayload;
exports.backendProbePayload = backendProbePayload;
const probes_1 = require("./probes");
Object.defineProperty(exports, "hasExecutable", { enumerable: true, get: function () { return probes_1.hasExecutable; } });
const local_1 = require("./local");
const envelopes_1 = require("./envelopes");
const container_1 = require("./container");
const remote_1 = require("./remote");
const ci_1 = require("./ci");
const agent_1 = require("./agent");
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
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" },
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
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" },
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
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" },
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
        support: { read: "enforce", write: "enforce", command: "enforce", network: "enforce", env: "enforce" },
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
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" },
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
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "enforce" },
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
        support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "attest" },
    },
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
        readiness: spec.readiness,
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
function ctxDelegate(impl) {
    return (ctx) => impl(ctx.descriptor, ctx.policy, ctx.request, ctx.label, ctx.handle, ctx.attestation);
}
const BUILTIN_DRIVER_BEHAVIORS = {
    node: { spawnStyle: "direct", runtimeNote: () => (0, local_1.runtimeNoteFor)("node"), probe: probes_1.probeNodeBackend },
    bun: { spawnStyle: "direct", runtimeNote: () => (0, local_1.runtimeNoteFor)("bun"), probe: probes_1.probeBunBackend },
    shell: { spawnStyle: "shell", runtimeNote: () => (0, local_1.runtimeNoteFor)("shell"), probe: probes_1.probeShellBackend },
    container: { delegateRun: ctxDelegate(container_1.runContainer), buildHandle: container_1.containerHandle, probe: probes_1.probeContainerBackend },
    remote: { delegateRun: ctxDelegate(remote_1.runHttpDelegation), buildHandle: remote_1.remoteHandle, probe: probes_1.probeRemoteBackend },
    ci: { delegateRun: ctxDelegate(ci_1.runCiDelegation), buildHandle: ci_1.ciHandle, probe: probes_1.probeCiBackend },
    agent: {
        delegateRun: (ctx) => (0, agent_1.runAgentProcess)(ctx.descriptor, ctx.policy, ctx.request, ctx.label, ctx.attestation),
        buildHandle: agent_1.agentHandle,
        commandlessDelegate: true,
        probe: probes_1.probeAgentBackend,
    },
};
for (const spec of DRIVER_SPECS) {
    registerBackend({ spec, ...(BUILTIN_DRIVER_BEHAVIORS[spec.id] || {}) });
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
                available: backendIds(),
            });
        }
        return { backendId: normalizedRequested, source: "flag", requested: normalizedRequested };
    }
    const envBackend = env.CW_BACKEND && env.CW_BACKEND.trim() ? env.CW_BACKEND.trim() : undefined;
    if (envBackend) {
        if (!isBackendId(envBackend)) {
            throw new BackendError("backend-not-found", `Unknown execution backend in CW_BACKEND: ${envBackend}`, {
                backendId: envBackend,
                available: backendIds(),
            });
        }
        return { backendId: envBackend, source: "env", requested: envBackend };
    }
    return { backendId: exports.DEFAULT_BACKEND_ID, source: "default" };
}
// ---------------------------------------------------------------------------
// Sandbox dimension mapping + attestation.
// ---------------------------------------------------------------------------
function requiredSandboxDimensions(policy) {
    const required = [];
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
        notes: options.notes,
    };
}
// ---------------------------------------------------------------------------
// Readiness probe.
// ---------------------------------------------------------------------------
function probeBackend(id, context = {}) {
    const descriptor = getBackendDescriptor(id);
    const driver = BACKEND_REGISTRY.get(id);
    const body = driver?.probe ? driver.probe(context) : { checks: [], readiness: descriptor.readiness };
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
        reason: body.reason,
    };
}
// ---------------------------------------------------------------------------
// The run entry.
// ---------------------------------------------------------------------------
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
function delegationHandle(descriptor, request) {
    return getBackendDriver(descriptor.id)?.buildHandle?.(request);
}
function delegate(descriptor, policy, request, label, probe) {
    const handle = delegationHandle(descriptor, request);
    if (!handle) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-target-missing", probe.reason || `Backend ${descriptor.id} has no delegation target; refusing rather than running unsandboxed`, attestSandbox(descriptor, policy, { mode: "execute", ready: probe.ready }));
    }
    if (!getBackendDriver(descriptor.id)?.commandlessDelegate && !request.command) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "no-command", `Backend ${descriptor.id} requires a command to delegate`, attestSandbox(descriptor, policy, { mode: "execute", ready: probe.ready }));
    }
    const attestation = attestSandbox(descriptor, policy, {
        mode: "execute",
        ready: true,
        handle,
        notes: [`delegated: ${descriptor.id} -> ${handle.ref}`],
    });
    const driver = getBackendDriver(descriptor.id);
    if (!driver?.delegateRun) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "backend-not-runnable", `Backend ${descriptor.id} has no delegate runner`, attestation);
    }
    return driver.delegateRun({ descriptor, policy, request, label, handle, attestation });
}
function runBackend(request) {
    const descriptor = getBackendDescriptor(request.backendId);
    const policy = request.sandboxPolicy;
    const label = request.label || request.command || `${descriptor.id}-execution`;
    const probe = probeBackend(descriptor.id, { cwd: request.cwd });
    if (request.command) {
        const denied = commandDenied(policy, `${request.command} ${(request.args || []).join(" ")}`.trim());
        if (denied) {
            return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "sandbox-command-denied", denied, attestSandbox(descriptor, policy, { mode: "execute", ready: probe.ready }));
        }
    }
    const attestation = attestSandbox(descriptor, policy, { mode: "execute", ready: probe.ready });
    if (attestation.unenforceable.length) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "sandbox-unenforceable", `Backend ${descriptor.id} cannot enforce or attest required sandbox dimension(s): ${attestation.unenforceable.join(", ")}`, attestation);
    }
    if (descriptor.kind === "delegating") {
        return delegate(descriptor, policy, request, label, probe);
    }
    if (!probe.ready) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "backend-not-ready", probe.reason || `Backend ${descriptor.id} is not ready`, attestation);
    }
    if (!request.command) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "no-command", `Backend ${descriptor.id} requires a command to execute`, attestation);
    }
    return (0, local_1.executeLocal)(descriptor, request, label, attestation, getBackendDriver(descriptor.id)?.spawnStyle);
}
function createExecutionBackend(id) {
    const descriptor = getBackendDescriptor(id);
    return {
        descriptor,
        probe: (context) => probeBackend(id, context),
        run: (request) => runBackend({ ...request, backendId: id }),
    };
}
// ---- inspection payloads ---------------------------------------------------
function backendListPayload() {
    return { schemaVersion: 1, default: exports.DEFAULT_BACKEND_ID, backends: listBackendDescriptors() };
}
function backendShowPayload(id) {
    return getBackendDescriptor(id);
}
const _probeCache = new Map();
function probeCacheTtlMs() {
    const raw = process.env.CW_PROBE_CACHE_TTL_MS;
    const n = raw ? parseInt(raw, 10) : 60_000;
    return Number.isFinite(n) && n >= 0 ? n : 60_000;
}
function cachedProbeBackend(id, context) {
    const key = `${id}:${context.cwd || ""}`;
    const cached = _probeCache.get(key);
    if (cached && Date.now() - cached.at < probeCacheTtlMs())
        return cached.result;
    const result = probeBackend(id, context);
    _probeCache.set(key, { result, at: Date.now() });
    return result;
}
function backendProbePayload(id, context = {}) {
    if (id && id.trim())
        return cachedProbeBackend(id.trim(), context);
    return { schemaVersion: 1, default: exports.DEFAULT_BACKEND_ID, probes: backendIds().map((backendId) => cachedProbeBackend(backendId, context)) };
}

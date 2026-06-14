"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeNodeBackend = probeNodeBackend;
exports.probeShellBackend = probeShellBackend;
exports.probeBunBackend = probeBunBackend;
exports.probeContainerBackend = probeContainerBackend;
exports.probeRemoteBackend = probeRemoteBackend;
exports.probeCiBackend = probeCiBackend;
exports.probeAgentBackend = probeAgentBackend;
// Per-backend readiness probe bodies for the execution-backend driver layer.
// Carved out of execution-backend.ts (FreeBSD-audit god-module carve) so the
// driver layer no longer bundles every driver's readiness check; the parent's
// `probeBackend` still wraps these with the descriptor-derived envelope, and each
// built-in driver references its probe through BUILTIN_DRIVER_BEHAVIORS.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each probe is a
// pure free function of the host (PATH + configured env), matching the existing
// router pattern (run-registry/derive.ts, orchestrator/*-operations.ts).
//
// Readiness probe. Deterministic given the host (PATH + configured env).
const node_fs_1 = __importDefault(require("node:fs"));
const util_1 = require("./util");
function probeNodeBackend() {
    const ok = (0, util_1.hasExecutable)("node");
    return {
        checks: [{ name: "node-runtime", ok, detail: ok ? "node on PATH" : "node not found on PATH" }],
        readiness: ok ? "ready" : "unavailable",
        reason: ok ? undefined : "node runtime not found on PATH"
    };
}
function probeShellBackend() {
    const ok = (0, util_1.hasExecutable)("sh") || node_fs_1.default.existsSync("/bin/sh");
    return {
        checks: [{ name: "posix-shell", ok, detail: ok ? "sh available" : "no POSIX shell found" }],
        readiness: ok ? "ready" : "unavailable",
        reason: ok ? undefined : "POSIX shell not found"
    };
}
function probeBunBackend() {
    const bun = (0, util_1.hasExecutable)("bun");
    const node = (0, util_1.hasExecutable)("node");
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
    const docker = (0, util_1.hasExecutable)("docker");
    const podman = (0, util_1.hasExecutable)("podman");
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

"use strict";
// shell/execution-backend/probes.ts — per-backend readiness probe bodies.
//
// MILESTONE 5 (v2/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend/probes.ts. Each probe is a
// pure free function of the host (PATH + configured env); the registry's
// `probeBackend` wraps these with the descriptor-derived envelope.
//
// Evidence: SPEC/execution-backend.md "Probes".
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasExecutable = hasExecutable;
exports.probeNodeBackend = probeNodeBackend;
exports.probeShellBackend = probeShellBackend;
exports.probeBunBackend = probeBunBackend;
exports.probeContainerBackend = probeContainerBackend;
exports.probeRemoteBackend = probeRemoteBackend;
exports.probeCiBackend = probeCiBackend;
exports.probeAgentBackend = probeAgentBackend;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function hasExecutable(name, env = process.env) {
    const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = path.join(dir, name);
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                return true;
        }
        catch {
            // ignore unreadable PATH entries
        }
    }
    return false;
}
function probeNodeBackend() {
    const ok = hasExecutable("node");
    return {
        checks: [{ name: "node-runtime", ok, detail: ok ? "node on PATH" : "node not found on PATH" }],
        readiness: ok ? "ready" : "unavailable",
        reason: ok ? undefined : "node runtime not found on PATH",
    };
}
function probeShellBackend() {
    const ok = hasExecutable("sh") || fs.existsSync("/bin/sh");
    return {
        checks: [{ name: "posix-shell", ok, detail: ok ? "sh available" : "no POSIX shell found" }],
        readiness: ok ? "ready" : "unavailable",
        reason: ok ? undefined : "POSIX shell not found",
    };
}
function probeBunBackend() {
    const bun = hasExecutable("bun");
    const node = hasExecutable("node");
    return {
        checks: [
            { name: "bun-runtime", ok: bun, detail: bun ? "bun on PATH" : "bun not found; node-compatible fallback" },
            { name: "node-compatible-fallback", ok: node, detail: node ? "node on PATH" : "node not found on PATH" },
        ],
        readiness: bun || node ? "ready" : "unavailable",
        reason: !bun && node
            ? "bun not installed; executing via node-compatible runtime"
            : !bun && !node
                ? "neither bun nor node found on PATH"
                : undefined,
    };
}
function probeContainerBackend() {
    const docker = hasExecutable("docker");
    const podman = hasExecutable("podman");
    return {
        checks: [
            { name: "docker", ok: docker, detail: docker ? "docker on PATH" : "docker not found" },
            { name: "podman", ok: podman, detail: podman ? "podman on PATH" : "podman not found" },
        ],
        readiness: docker || podman ? "ready" : "unavailable",
        reason: docker || podman ? undefined : "no container runtime (docker/podman) found; supply --image to delegate explicitly",
    };
}
function delegateChildExists() {
    // __dirname is dist/shell/execution-backend — three levels up reaches
    // the package root (scripts/ is a sibling of dist/, not two levels up).
    return fs.existsSync(path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-delegate-child.js"));
}
function probeRemoteBackend(env = process.env) {
    const endpoint = (env.CW_REMOTE_ENDPOINT || "").trim();
    const scriptOk = delegateChildExists();
    const checks = [
        { name: "endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_REMOTE_ENDPOINT configured" : "CW_REMOTE_ENDPOINT not set" },
        {
            name: "delegate-child-script",
            ok: scriptOk,
            detail: scriptOk ? "http-delegate-child.js found" : "http-delegate-child.js missing — reinstall cool-workflow",
        },
    ];
    const readiness = !endpoint ? "unverified" : !scriptOk ? "unavailable" : "ready";
    return {
        checks,
        readiness,
        reason: readiness === "ready"
            ? undefined
            : !endpoint
                ? "no remote endpoint configured (set CW_REMOTE_ENDPOINT or pass --endpoint)"
                : "delegate child script is missing",
    };
}
function probeCiBackend(env = process.env) {
    const endpoint = (env.CW_CI_ENDPOINT || "").trim();
    const scriptOk = delegateChildExists();
    const checks = [
        { name: "ci-endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_CI_ENDPOINT configured" : "CW_CI_ENDPOINT not set" },
        {
            name: "delegate-child-script",
            ok: scriptOk,
            detail: scriptOk ? "http-delegate-child.js found" : "http-delegate-child.js missing — reinstall cool-workflow",
        },
    ];
    const readiness = !endpoint ? "unverified" : !scriptOk ? "unavailable" : "ready";
    return {
        checks,
        readiness,
        reason: readiness === "ready"
            ? undefined
            : !endpoint
                ? "no CI job target configured (set CW_CI_ENDPOINT or pass --job)"
                : "delegate child script is missing",
    };
}
function probeAgentBackend(env = process.env) {
    // Mirrors remote/ci EXACTLY: unconfigured ⇒ `unverified` (NOT a hard
    // refusal), configured ⇒ `ready`.
    const command = (env.CW_AGENT_COMMAND || "").trim();
    const endpoint = (env.CW_AGENT_ENDPOINT || "").trim();
    const configured = Boolean(command || endpoint);
    return {
        checks: [
            { name: "agent-command", ok: Boolean(command), detail: command ? "CW_AGENT_COMMAND configured" : "CW_AGENT_COMMAND not set" },
            { name: "agent-endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_AGENT_ENDPOINT configured" : "CW_AGENT_ENDPOINT not set" },
        ],
        readiness: configured ? "ready" : "unverified",
        reason: configured ? undefined : "no agent configured (set CW_AGENT_COMMAND or CW_AGENT_ENDPOINT, or pass --agent-command/--agent-endpoint)",
    };
}

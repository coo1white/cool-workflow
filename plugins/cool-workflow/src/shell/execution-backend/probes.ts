// shell/execution-backend/probes.ts — per-backend readiness probe bodies.
//
// MILESTONE 5 (project/docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// the old build's execution-backend probes module. Each probe is a
// pure free function of the host (PATH + configured env); the registry's
// `probeBackend` wraps these with the descriptor-derived envelope.
//
// Evidence: SPEC/execution-backend.md "Probes".

import * as fs from "node:fs";
import * as path from "node:path";

export interface BackendProbeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface BackendProbeBody {
  checks: BackendProbeCheck[];
  readiness: "ready" | "unavailable" | "unverified";
  reason?: string;
}

export function hasExecutable(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
    } catch {
      // ignore unreadable PATH entries
    }
  }
  return false;
}

export function probeNodeBackend(): BackendProbeBody {
  const ok = hasExecutable("node");
  return {
    checks: [{ name: "node-runtime", ok, detail: ok ? "node on PATH" : "node not found on PATH" }],
    readiness: ok ? "ready" : "unavailable",
    reason: ok ? undefined : "node runtime not found on PATH",
  };
}

export function probeShellBackend(): BackendProbeBody {
  const ok = hasExecutable("sh") || fs.existsSync("/bin/sh");
  return {
    checks: [{ name: "posix-shell", ok, detail: ok ? "sh available" : "no POSIX shell found" }],
    readiness: ok ? "ready" : "unavailable",
    reason: ok ? undefined : "POSIX shell not found",
  };
}

export function probeBunBackend(): BackendProbeBody {
  const bun = hasExecutable("bun");
  const node = hasExecutable("node");
  return {
    checks: [
      { name: "bun-runtime", ok: bun, detail: bun ? "bun on PATH" : "bun not found; node-compatible fallback" },
      { name: "node-compatible-fallback", ok: node, detail: node ? "node on PATH" : "node not found on PATH" },
    ],
    readiness: bun || node ? "ready" : "unavailable",
    reason:
      !bun && node
        ? "bun not installed; executing via node-compatible runtime"
        : !bun && !node
          ? "neither bun nor node found on PATH"
          : undefined,
  };
}

export function probeContainerBackend(): BackendProbeBody {
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

function delegateChildExists(): boolean {
  // __dirname is dist/shell/execution-backend — three levels up reaches
  // the package root (scripts/ is a sibling of dist/, not two levels up).
  return fs.existsSync(path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-delegate-child.js"));
}

export function probeRemoteBackend(env: NodeJS.ProcessEnv = process.env): BackendProbeBody {
  const endpoint = (env.CW_REMOTE_ENDPOINT || "").trim();
  const scriptOk = delegateChildExists();
  const checks: BackendProbeCheck[] = [
    { name: "endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_REMOTE_ENDPOINT configured" : "CW_REMOTE_ENDPOINT not set" },
    {
      name: "delegate-child-script",
      ok: scriptOk,
      detail: scriptOk ? "http-delegate-child.js found" : "http-delegate-child.js missing — reinstall cool-workflow",
    },
  ];
  const readiness: BackendProbeBody["readiness"] = !endpoint ? "unverified" : !scriptOk ? "unavailable" : "ready";
  return {
    checks,
    readiness,
    reason:
      readiness === "ready"
        ? undefined
        : !endpoint
          ? "no remote endpoint configured (set CW_REMOTE_ENDPOINT or pass --endpoint)"
          : "delegate child script is missing",
  };
}

export function probeCiBackend(env: NodeJS.ProcessEnv = process.env): BackendProbeBody {
  const endpoint = (env.CW_CI_ENDPOINT || "").trim();
  const scriptOk = delegateChildExists();
  const checks: BackendProbeCheck[] = [
    { name: "ci-endpoint", ok: Boolean(endpoint), detail: endpoint ? "CW_CI_ENDPOINT configured" : "CW_CI_ENDPOINT not set" },
    {
      name: "delegate-child-script",
      ok: scriptOk,
      detail: scriptOk ? "http-delegate-child.js found" : "http-delegate-child.js missing — reinstall cool-workflow",
    },
  ];
  const readiness: BackendProbeBody["readiness"] = !endpoint ? "unverified" : !scriptOk ? "unavailable" : "ready";
  return {
    checks,
    readiness,
    reason:
      readiness === "ready"
        ? undefined
        : !endpoint
          ? "no CI job target configured (set CW_CI_ENDPOINT or pass --job)"
          : "delegate child script is missing",
  };
}

export function probeAgentBackend(env: NodeJS.ProcessEnv = process.env): BackendProbeBody {
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

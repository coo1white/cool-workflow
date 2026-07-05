// shell/execution-backend/container.ts — the container delegating driver.
//
// MILESTONE 5 (v2/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts's container handle builder
// (:1068-1075) and `runContainer` (:720-792).
//
// Evidence: SPEC/execution-backend.md "container driver (runContainer)".

import { spawnSync } from "node:child_process";
import { hasExecutable } from "./probes";
import { delegatedEnvelope, refusedEnvelope } from "./envelopes";
import {
  BackendDescriptor,
  BackendExecutionHandle,
  ExecutionRequest,
  ExecutionResultEnvelope,
  ResolvedSandboxPolicy,
  SandboxAttestation,
} from "./types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function containerHandle(request: ExecutionRequest, env: NodeJS.ProcessEnv = process.env): BackendExecutionHandle | undefined {
  const delegation = request.delegation || {};
  const image = delegation.image || (env.CW_CONTAINER_IMAGE || "").trim() || undefined;
  if (!image) return undefined;
  const digest = delegation.digest || (env.CW_CONTAINER_DIGEST || "").trim() || undefined;
  const ref = digest ? `${image}@${digest}` : image;
  return { kind: "container", ref, image, digest };
}

/** container — real `docker`/`podman run` under the sandbox contract. Fails
 *  closed when no runtime is on PATH, the daemon is unreachable, or the
 *  runtime itself errors (exit 125) — distinct from the command's own
 *  non-zero exit. Byte-exact port of src/execution-backend.ts:720-792. */
export function runContainer(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const runtime = hasExecutable("docker") ? "docker" : hasExecutable("podman") ? "podman" : undefined;
  if (!runtime) {
    return refusedEnvelope(descriptor, policy, label, "runtime-unavailable", "no container runtime (docker/podman) on PATH", attestation);
  }
  const ping = spawnSync(runtime, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 15000 });
  const daemonUp = !ping.error && ping.status === 0 && String(ping.stdout || "").trim().length > 0;
  if (!daemonUp) {
    const why = (String(ping.stderr || "").split("\n").find((line) => line.trim()) || `${runtime} daemon not reachable`).trim();
    return refusedEnvelope(descriptor, policy, label, "runtime-unavailable", `${runtime} daemon is not reachable: ${why}`, attestation);
  }
  const command = String(request.command);
  const args = (request.args || []).map(String);
  const cwd = request.cwd || process.cwd();

  const runArgs = ["run", "--rm"];
  if (policy.network.mode !== "any") runArgs.push("--network", "none");
  runArgs.push("-v", `${cwd}:${cwd}:ro`, "-w", cwd);
  if (policy.env.inherit || (policy.env.expose && policy.env.expose.length)) {
    for (const name of policy.env.inherit ? Object.keys(process.env) : policy.env.expose || []) {
      if (name === "PATH" || name === "HOME") continue;
      const value = process.env[name];
      if (value !== undefined) runArgs.push("-e", `${name}=${value}`);
    }
  }
  runArgs.push(handle.ref, command, ...args);

  const result = spawnSync(runtime, runArgs, { cwd, encoding: "utf8", timeout: request.timeoutMs, maxBuffer: 32 * 1024 * 1024 });

  if (result.error) {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${runtime} run failed: ${messageOf(result.error)}`, attestation);
  }
  const exitCode = typeof result.status === "number" ? result.status : null;
  if (exitCode === 125 || exitCode === null) {
    const why = (String(result.stderr || "").split("\n").find((line) => line.trim()) || "container runtime error").trim();
    return refusedEnvelope(descriptor, policy, label, "runtime-unavailable", `${runtime} could not run the container: ${why}`, attestation);
  }
  return delegatedEnvelope(descriptor, label, handle, attestation, command, args, exitCode, String(result.stdout || ""));
}

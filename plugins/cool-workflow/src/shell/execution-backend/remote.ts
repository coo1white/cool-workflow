// shell/execution-backend/remote.ts — remote/ci delegating drivers (shared
// HTTP-delegation body) + handle builders.
//
// MILESTONE 5 (v2/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts's `runHttpDelegation`
// (:821-876), `remoteHandle` (:1077-1084), `ciHandle` (:1086-1093), and
// `delegateChildScript` (:801-811).
//
// Evidence: SPEC/execution-backend.md "remote / ci drivers
// (runHttpDelegation)".

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { delegatedEnvelope, refusedEnvelope } from "./envelopes";
import { buildChildEnv } from "./local";
import { BackendDescriptor, BackendExecutionHandle, ExecutionRequest, ExecutionResultEnvelope, ResolvedSandboxPolicy, SandboxAttestation } from "./types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves scripts/children/http-delegate-child.js next to the compiled
 *  module. Throws the exact broken-installation message when missing. */
export function delegateChildScript(): string {
  // __dirname is dist/shell/execution-backend — three levels up reaches
  // the package root (scripts/ is a sibling of dist/, not two levels up).
  const resolved = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-delegate-child.js");
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Delegate child script not found at ${resolved}. ` +
        `This indicates a broken installation — reinstall cool-workflow or ensure ` +
        `"scripts/children/http-delegate-child.js" is shipped in the package.`
    );
  }
  return resolved;
}

export function remoteHandle(request: ExecutionRequest, env: NodeJS.ProcessEnv = process.env): BackendExecutionHandle | undefined {
  const delegation = request.delegation || {};
  const endpoint = delegation.endpoint || (env.CW_REMOTE_ENDPOINT || "").trim() || undefined;
  if (!endpoint) return undefined;
  const jobId = delegation.jobId || (env.CW_REMOTE_JOB || "").trim() || undefined;
  const ref = jobId ? `${endpoint}#${jobId}` : endpoint;
  return { kind: "remote", ref, endpoint, jobId };
}

export function ciHandle(request: ExecutionRequest, env: NodeJS.ProcessEnv = process.env): BackendExecutionHandle | undefined {
  const delegation = request.delegation || {};
  const endpoint = delegation.endpoint || (env.CW_CI_ENDPOINT || "").trim() || undefined;
  const jobId = delegation.jobId || (env.CW_CI_JOB || "").trim() || undefined;
  if (!endpoint && !jobId) return undefined;
  const ref = endpoint && jobId ? `${endpoint}#${jobId}` : jobId || endpoint || "";
  return { kind: "ci", ref, endpoint, jobId };
}

/** remote / ci — real HTTP delegation. POSTs the job to the configured
 *  endpoint (and polls a returned jobId) via a Node child, then records the
 *  runner's exit + stdout digest as canonical evidence. Fails closed when
 *  the endpoint is missing, unreachable, errors, or returns no exitCode. */
export function runHttpDelegation(
  descriptor: BackendDescriptor,
  policy: ResolvedSandboxPolicy,
  request: ExecutionRequest,
  label: string,
  handle: BackendExecutionHandle,
  attestation: SandboxAttestation
): ExecutionResultEnvelope {
  const endpoint = handle.endpoint;
  if (!endpoint) {
    return refusedEnvelope(descriptor, policy, label, "delegation-target-missing", `Backend ${descriptor.id} has no endpoint to POST to`, attestation);
  }
  const command = String(request.command);
  const args = (request.args || []).map(String);
  const job = JSON.stringify({
    command,
    args,
    env: buildChildEnv(policy),
    sandboxProfileId: policy.id,
    jobId: handle.jobId,
  });

  const child = spawnSync(process.execPath, [delegateChildScript()], {
    input: job,
    env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
    encoding: "utf8",
    timeout: request.timeoutMs || 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (child.error) {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${descriptor.id} delegation failed: ${messageOf(child.error)}`, attestation);
  }
  let parsed: { exitCode?: number; stdout?: string; error?: string };
  try {
    parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
  } catch {
    return refusedEnvelope(descriptor, policy, label, "delegation-failed", `${descriptor.id} runner returned an unparseable response`, attestation);
  }
  if (parsed.error || typeof parsed.exitCode !== "number") {
    return refusedEnvelope(
      descriptor,
      policy,
      label,
      "delegation-failed",
      `${descriptor.id} runner error: ${parsed.error || "no exitCode reported"}`,
      attestation
    );
  }
  return delegatedEnvelope(descriptor, label, handle, attestation, command, args, parsed.exitCode, String(parsed.stdout || ""));
}

"use strict";
// shell/execution-backend/container.ts — the container delegating driver.
//
// MILESTONE 5 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts's container handle builder
// (:1068-1075) and `runContainer` (:720-792).
//
// Evidence: SPEC/execution-backend.md "container driver (runContainer)".
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildContainerEnvArgs = buildContainerEnvArgs;
exports.containerHandle = containerHandle;
exports.runContainer = runContainer;
const node_child_process_1 = require("node:child_process");
const probes_1 = require("./probes");
const local_1 = require("./local");
const envelopes_1 = require("./envelopes");
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** buildContainerEnvArgs — build the `-e NAME=value` args passed into the
 *  container run command. Pulled out as its own pure function so it can be
 *  checked without a real docker/podman on the box (see local.ts's
 *  buildChildEnv for the same shape of test-only split).
 *
 *  deny must win here too: an operator who sets inherit:true plus a deny
 *  list (a valid, normalized combination — see sandbox-profile.ts's
 *  normalizeEnv) means "everything EXCEPT these". Before this fix, deny was
 *  never read here, so a secret like AWS_SECRET_ACCESS_KEY that the operator
 *  named in deny still got copied into the container's `-e` args.
 *
 *  This backend builds its `-e` args straight from baseEnv rather than through
 *  buildChildEnv, so it must apply CW_NEVER_FORWARD_ENV itself — otherwise
 *  inherit:true would still copy CW's own parent-only secrets (the release
 *  signing key, the workbench token) into the container. */
function buildContainerEnvArgs(policy, baseEnv = process.env) {
    const args = [];
    if (policy.env.inherit || (policy.env.expose && policy.env.expose.length)) {
        const deny = new Set(policy.env.deny || []);
        for (const name of policy.env.inherit ? Object.keys(baseEnv) : policy.env.expose || []) {
            if (name === "PATH" || name === "HOME")
                continue;
            if (deny.has(name))
                continue;
            if (local_1.CW_NEVER_FORWARD_ENV.has(name))
                continue; // parent-only secrets never enter the container
            const value = baseEnv[name];
            if (value !== undefined)
                args.push("-e", `${name}=${value}`);
        }
    }
    return args;
}
function containerHandle(request, env = process.env) {
    const delegation = request.delegation || {};
    const image = delegation.image || (env.CW_CONTAINER_IMAGE || "").trim() || undefined;
    if (!image)
        return undefined;
    const digest = delegation.digest || (env.CW_CONTAINER_DIGEST || "").trim() || undefined;
    const ref = digest ? `${image}@${digest}` : image;
    return { kind: "container", ref, image, digest };
}
/** container — real `docker`/`podman run` under the sandbox contract. Fails
 *  closed when no runtime is on PATH, the daemon is unreachable, or the
 *  runtime itself errors (exit 125) — distinct from the command's own
 *  non-zero exit. Byte-exact port of src/execution-backend.ts:720-792. */
function runContainer(descriptor, policy, request, label, handle, attestation) {
    const runtime = (0, probes_1.hasExecutable)("docker") ? "docker" : (0, probes_1.hasExecutable)("podman") ? "podman" : undefined;
    if (!runtime) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "runtime-unavailable", "no container runtime (docker/podman) on PATH", attestation);
    }
    const ping = (0, node_child_process_1.spawnSync)(runtime, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 15000 });
    const daemonUp = !ping.error && ping.status === 0 && String(ping.stdout || "").trim().length > 0;
    if (!daemonUp) {
        const why = (String(ping.stderr || "").split("\n").find((line) => line.trim()) || `${runtime} daemon not reachable`).trim();
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "runtime-unavailable", `${runtime} daemon is not reachable: ${why}`, attestation);
    }
    const command = String(request.command);
    const args = (request.args || []).map(String);
    const cwd = request.cwd || process.cwd();
    const runArgs = ["run", "--rm"];
    if (policy.network.mode !== "any")
        runArgs.push("--network", "none");
    runArgs.push("-v", `${cwd}:${cwd}:ro`, "-w", cwd);
    runArgs.push(...buildContainerEnvArgs(policy));
    runArgs.push(handle.ref, command, ...args);
    // An unset timeoutMs must not mean "no timeout" — spawnSync would then
    // block forever on a hung container with no kill path. 600000 matches the
    // agent backend's own default fallback (execution-backend/agent.ts).
    // killSignal SIGKILL, not the default SIGTERM: a container runtime that
    // ignores SIGTERM would leave this blocking spawnSync waiting forever (no
    // second-stage escalation is possible from inside a sync call), so the
    // timeout above would not actually bound anything. SIGKILL is uncatchable,
    // so the runtime always dies and spawnSync returns; a timed-out run is
    // classified the same either way (status null, ETIMEDOUT message does not
    // name the signal, result.signal is never recorded). Mirrors agent.ts.
    const result = (0, node_child_process_1.spawnSync)(runtime, runArgs, { cwd, encoding: "utf8", timeout: request.timeoutMs || 600000, maxBuffer: 32 * 1024 * 1024, killSignal: "SIGKILL" });
    if (result.error) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `${runtime} run failed: ${messageOf(result.error)}`, attestation);
    }
    const exitCode = typeof result.status === "number" ? result.status : null;
    if (exitCode === 125 || exitCode === null) {
        const why = (String(result.stderr || "").split("\n").find((line) => line.trim()) || "container runtime error").trim();
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "runtime-unavailable", `${runtime} could not run the container: ${why}`, attestation);
    }
    return (0, envelopes_1.delegatedEnvelope)(descriptor, label, handle, attestation, command, args, exitCode, String(result.stdout || ""));
}

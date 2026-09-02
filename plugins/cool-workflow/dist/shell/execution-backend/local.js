"use strict";
// shell/execution-backend/local.ts — the local-execution driver body
// (executeLocal) shared by the node/bun/shell built-in drivers.
//
// MILESTONE 5 (PLAN.md (project/docs/rebuild) build order, step 5). Byte-exact port of
// the old build's execution-backend module's `executeLocal` plus the leaf
// helpers it needs (sha256/hasExecutable/messageOf).
//
// Evidence: SPEC/execution-backend.md "Local execution (executeLocal)".
Object.defineProperty(exports, "__esModule", { value: true });
exports.CW_NEVER_FORWARD_ENV = void 0;
exports.buildChildEnv = buildChildEnv;
exports.checkShellGuard = checkShellGuard;
exports.runtimeNoteFor = runtimeNoteFor;
exports.executeLocal = executeLocal;
const node_child_process_1 = require("node:child_process");
const hash_1 = require("../../core/hash");
const probes_1 = require("./probes");
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** CW's OWN secrets that must NEVER reach ANY child process — on any backend
 *  (local/container/remote/agent), regardless of policy.env.inherit / expose /
 *  deny. Each is read only by parent-side tooling, so no spawned child ever
 *  needs it; stripping them here, unconditionally, is a fail-closed backstop
 *  that does not depend on an operator remembering to list them in
 *  policy.env.deny. Do NOT add the agent-attest private key
 *  (CW_AGENT_ATTEST_PRIVKEY) here: the attest wrapper
 *  (scripts/agents/cw-attest-wrap.js) is spawned AS the agent and must receive
 *  it to sign telemetry. */
exports.CW_NEVER_FORWARD_ENV = new Set([
    "CW_RELEASE_VERDICT_PRIVKEY", // release verdict signing key — release-flow.js only
    "CW_WORKBENCH_TOKEN", // workbench HTTP bearer token — workbench-host.ts only
    "CW_BENCH_TRACE_FILE", // benchmark trace path — parent drive only
]);
function buildChildEnv(policy, baseEnv = process.env) {
    // deny must win regardless of inherit: a custom profile combining
    // inherit:true with deny:[...] (a valid, normalized combination — see
    // sandbox-profile.ts's normalizeEnv) means "everything EXCEPT these".
    // An early return on inherit before this loop ran meant deny was
    // silently skipped whenever inherit was true.
    const env = policy.env.inherit ? { ...baseEnv } : {};
    if (!policy.env.inherit) {
        if (baseEnv.PATH !== undefined)
            env.PATH = baseEnv.PATH;
        if (baseEnv.HOME !== undefined)
            env.HOME = baseEnv.HOME;
        for (const name of policy.env.expose || []) {
            if (baseEnv[name] !== undefined)
                env[name] = baseEnv[name];
        }
    }
    for (const name of policy.env.deny || []) {
        delete env[name];
    }
    // Fail-closed backstop: parent-only secrets never cross into a child, even
    // when inherit:true forwarded them above or an operator exposed one by name.
    for (const name of exports.CW_NEVER_FORWARD_ENV)
        delete env[name];
    return env;
}
/** Shell injection guard (SPEC/execution-backend.md "Local execution"): for
 *  the `shell` driver, the joined string (with `{{token}}` placeholders
 *  taken out first) must not match the control-character set. Throws a
 *  plain Error with the byte-exact message on a hit.
 *
 *  Quote marks and the backslash are in the set as well (2026-08-24, audit
 *  recommendation 7): with them out, every line this guard lets through is
 *  split by white space only — the same way a POSIX shell would split it —
 *  so the line can be run with NO shell process at all (see executeLocal).
 *  The guard is then a filter, not the safety: even a character that got
 *  past it would go to the child as plain argv bytes, never to a shell. */
function checkShellGuard(command, args) {
    const shellArg = [command, ...args].join(" ").replace(/\{\{[a-zA-Z0-9_.-]+\}\}/g, "");
    if (/[;&|`$(){}<>!\n\r#*?~'"\\]/.test(shellArg)) {
        throw new Error(`Shell backend refused: args contain shell control characters. ` +
            `Use the node, bun, or agent backend instead for untrusted inputs.`);
    }
}
function runtimeNoteFor(backendId) {
    if (backendId === "bun") {
        return (0, probes_1.hasExecutable)("bun") ? "bun (node-compatible execution)" : "node-compatible (bun not installed)";
    }
    if (backendId === "shell")
        return "posix-shell";
    return "node";
}
/** executeLocal — spawn a thin child process and capture verifiable
 *  evidence (exit code + output digest). Byte-exact port of
 *  the old build's execution-backend module. */
function executeLocal(descriptor, request, label, attestation, spawnStyle) {
    const command = String(request.command);
    const args = (request.args || []).map(String);
    const env = buildChildEnv(request.sandboxPolicy);
    const options = {
        cwd: request.cwd,
        env,
        encoding: "utf8",
        // An unset timeoutMs must not mean "no timeout" — spawnSync would then
        // block forever on a hung child with no kill path. 600000 matches the
        // agent backend's own default fallback (execution-backend/agent.ts).
        timeout: request.timeoutMs || 600000,
        maxBuffer: 32 * 1024 * 1024,
        // SIGKILL, not the default SIGTERM: a child that ignores SIGTERM would
        // leave this blocking spawnSync waiting forever (no second-stage
        // escalation is possible from inside a sync call), so the `timeout` above
        // would not actually bound anything. SIGKILL is uncatchable, so the child
        // always dies and spawnSync returns. A timed-out run is classified as
        // failed regardless of the signal (status stays null, the ETIMEDOUT
        // message does not name the signal, and this backend never records
        // result.signal). The exact captured stdout/stderr on a timeout is not
        // guaranteed identical to the old SIGTERM path: a child that catches
        // SIGTERM could flush a last partial write or exit with a code before it
        // dies, while under SIGKILL it cannot — but that output belongs to a run
        // we already treat as failed, so the hard kill loses nothing that counts.
        // Mirrors execution-backend/agent.ts's fix.
        killSignal: "SIGKILL",
    };
    if (spawnStyle === "shell") {
        checkShellGuard(command, args);
    }
    const isTTY = Boolean(process.stderr.isTTY);
    const shortLabel = command.split("/").pop() || command;
    if (isTTY)
        process.stderr.write(`● Running ${shortLabel}...\n`);
    const startedAt = process.hrtime.bigint();
    // The "shell" style takes a command LINE, but no shell process ever runs
    // (audit recommendation 7). The guard above has already refused every
    // control character, quote, and escape, so POSIX word-splitting of the
    // line is white-space splitting — done here, then spawned as plain argv
    // with shell:false. Same child, same argv bytes as the old /bin/sh path
    // for every line the guard accepts; structurally safe for every line it
    // might ever miss.
    const shellTokens = spawnStyle === "shell"
        ? [command, ...args].join(" ").split(/\s+/).filter(Boolean)
        : [];
    const result = spawnStyle === "shell"
        ? (0, node_child_process_1.spawnSync)(shellTokens[0], shellTokens.slice(1), { ...options, shell: false })
        : (0, node_child_process_1.spawnSync)(command, args, { ...options, shell: false });
    const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    if (isTTY)
        process.stderr.write(`✓ Done (${elapsedMs}ms)\n`);
    const exitCode = typeof result.status === "number" ? result.status : null;
    const spawnError = result.error ? messageOf(result.error) : undefined;
    const stdout = String(result.stdout || "");
    const digest = (0, hash_1.sha256)(stdout);
    const status = spawnError ? "failed" : exitCode === 0 ? "completed" : "failed";
    const evidence = [`command:${[command, ...args].join(" ")}`, `exitCode:${exitCode === null ? "null" : exitCode}`, `stdoutSha256:${digest}`];
    const summary = status === "completed"
        ? `${label}: completed (exit 0)`
        : spawnError
            ? `${label}: failed (${spawnError})`
            : `${label}: failed (exit ${exitCode})`;
    const resultEnvelope = { summary, findings: [], evidence };
    const notes = [`runtime: ${runtimeNoteFor(descriptor.id)}`];
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
            attestation: { ...attestation, status: attestation.status, notes },
        },
    };
}

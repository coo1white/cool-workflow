"use strict";
// shell/execution-backend/local.ts — the local-execution driver body
// (executeLocal) shared by the node/bun/shell built-in drivers.
//
// MILESTONE 5 (docs/rebuild/PLAN.md build order, step 5). Byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts's `executeLocal` (lines
// 547-626) plus the leaf helpers it needs (sha256/hasExecutable/messageOf).
//
// Evidence: SPEC/execution-backend.md "Local execution (executeLocal)".
Object.defineProperty(exports, "__esModule", { value: true });
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
function buildChildEnv(policy, baseEnv = process.env) {
    if (policy.env.inherit)
        return { ...baseEnv };
    const env = {};
    if (baseEnv.PATH !== undefined)
        env.PATH = baseEnv.PATH;
    if (baseEnv.HOME !== undefined)
        env.HOME = baseEnv.HOME;
    for (const name of policy.env.expose || []) {
        if (baseEnv[name] !== undefined)
            env[name] = baseEnv[name];
    }
    for (const name of policy.env.deny || []) {
        delete env[name];
    }
    return env;
}
/** Shell injection guard (SPEC/execution-backend.md "Local execution"): for
 *  the `shell` driver, the joined string (with `{{token}}` placeholders
 *  taken out first) must not match the control-character set. Throws a
 *  plain Error with the byte-exact message on a hit. */
function checkShellGuard(command, args) {
    const shellArg = [command, ...args].join(" ").replace(/\{\{[a-zA-Z0-9_.-]+\}\}/g, "");
    if (/[;&|`$(){}<>!\n\r#*?~]/.test(shellArg)) {
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
 *  src/execution-backend.ts:547-626. */
function executeLocal(descriptor, request, label, attestation, spawnStyle) {
    const command = String(request.command);
    const args = (request.args || []).map(String);
    const env = buildChildEnv(request.sandboxPolicy);
    const options = {
        cwd: request.cwd,
        env,
        encoding: "utf8",
        timeout: request.timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
    };
    if (spawnStyle === "shell") {
        checkShellGuard(command, args);
    }
    const isTTY = Boolean(process.stderr.isTTY);
    const shortLabel = command.split("/").pop() || command;
    if (isTTY)
        process.stderr.write(`● Running ${shortLabel}...\n`);
    const startedAt = process.hrtime.bigint();
    const result = spawnStyle === "shell"
        ? (0, node_child_process_1.spawnSync)([command, ...args].join(" "), { ...options, shell: true })
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

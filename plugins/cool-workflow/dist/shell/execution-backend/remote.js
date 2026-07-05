"use strict";
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
exports.delegateChildScript = delegateChildScript;
exports.remoteHandle = remoteHandle;
exports.ciHandle = ciHandle;
exports.runHttpDelegation = runHttpDelegation;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const envelopes_1 = require("./envelopes");
const local_1 = require("./local");
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Resolves scripts/children/http-delegate-child.js next to the compiled
 *  module. Throws the exact broken-installation message when missing. */
function delegateChildScript() {
    // __dirname is dist/shell/execution-backend — three levels up reaches
    // the package root (scripts/ is a sibling of dist/, not two levels up).
    const resolved = path.resolve(__dirname, "..", "..", "..", "scripts", "children", "http-delegate-child.js");
    if (!fs.existsSync(resolved)) {
        throw new Error(`Delegate child script not found at ${resolved}. ` +
            `This indicates a broken installation — reinstall cool-workflow or ensure ` +
            `"scripts/children/http-delegate-child.js" is shipped in the package.`);
    }
    return resolved;
}
function remoteHandle(request, env = process.env) {
    const delegation = request.delegation || {};
    const endpoint = delegation.endpoint || (env.CW_REMOTE_ENDPOINT || "").trim() || undefined;
    if (!endpoint)
        return undefined;
    const jobId = delegation.jobId || (env.CW_REMOTE_JOB || "").trim() || undefined;
    const ref = jobId ? `${endpoint}#${jobId}` : endpoint;
    return { kind: "remote", ref, endpoint, jobId };
}
function ciHandle(request, env = process.env) {
    const delegation = request.delegation || {};
    const endpoint = delegation.endpoint || (env.CW_CI_ENDPOINT || "").trim() || undefined;
    const jobId = delegation.jobId || (env.CW_CI_JOB || "").trim() || undefined;
    if (!endpoint && !jobId)
        return undefined;
    const ref = endpoint && jobId ? `${endpoint}#${jobId}` : jobId || endpoint || "";
    return { kind: "ci", ref, endpoint, jobId };
}
/** remote / ci — real HTTP delegation. POSTs the job to the configured
 *  endpoint (and polls a returned jobId) via a Node child, then records the
 *  runner's exit + stdout digest as canonical evidence. Fails closed when
 *  the endpoint is missing, unreachable, errors, or returns no exitCode. */
function runHttpDelegation(descriptor, policy, request, label, handle, attestation) {
    const endpoint = handle.endpoint;
    if (!endpoint) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-target-missing", `Backend ${descriptor.id} has no endpoint to POST to`, attestation);
    }
    const command = String(request.command);
    const args = (request.args || []).map(String);
    const job = JSON.stringify({
        command,
        args,
        env: (0, local_1.buildChildEnv)(policy),
        sandboxProfileId: policy.id,
        jobId: handle.jobId,
    });
    const child = (0, node_child_process_1.spawnSync)(process.execPath, [delegateChildScript()], {
        input: job,
        env: { ...process.env, CW_DELEGATE_ENDPOINT: endpoint },
        encoding: "utf8",
        timeout: request.timeoutMs || 120000,
        maxBuffer: 32 * 1024 * 1024,
    });
    if (child.error) {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `${descriptor.id} delegation failed: ${messageOf(child.error)}`, attestation);
    }
    let parsed;
    try {
        parsed = JSON.parse(String(child.stdout || "").trim() || "{}");
    }
    catch {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `${descriptor.id} runner returned an unparseable response`, attestation);
    }
    if (parsed.error || typeof parsed.exitCode !== "number") {
        return (0, envelopes_1.refusedEnvelope)(descriptor, policy, label, "delegation-failed", `${descriptor.id} runner error: ${parsed.error || "no exitCode reported"}`, attestation);
    }
    return (0, envelopes_1.delegatedEnvelope)(descriptor, label, handle, attestation, command, args, parsed.exitCode, String(parsed.stdout || ""));
}

// shell/doctor-conformance.ts — `cw doctor --conformance` (opt-in, 0.3.3): runs the agent once
// on a fixed task through runBackend and checks cw-agent/1 (docs/agent-delegation-drive.7.md).
// One short model call, so only when asked; all files in a temp dir removed after.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveAgentConfig } from "./agent-config.js";
import { runBackend } from "./execution-backend/registry.js";
import { resolveSandboxProfileById, sandboxContextForValidation } from "./sandbox-profile.js";
import { normalizeResultEnvelope } from "../core/pipeline/result-normalize.js";
export const AGENT_PROTOCOL = "cw-agent/1";
export const CONFORMANCE_MARKER = "cw-conformance-ok";
export const CONFORMANCE_PROMPT = [
    "This is a `cw doctor --conformance` check, not real work.",
    "Do not read, change or run anything. Answer with exactly this block and nothing else:",
    "",
    "```cw:result",
    `{"summary":"${CONFORMANCE_MARKER}","findings":[],"evidence":[]}`,
    "```",
    "",
].join("\n");
const FIX = "Run your agent command by hand with an input file and a result path (see `cw man agent-delegation-drive`, \"The agent contract\"), or pick a bundled agent with -claude / -codex / -gemini.";
export function probeAgentConformance(args, env) {
    const config = resolveAgentConfig(args, env);
    if (!config.command && !config.endpoint) {
        return { name: "agent-conformance", status: "warn", detail: "not run: no agent is configured.", fix: "Configure one first (cw doctor shows how), then run `cw doctor --conformance` again." };
    }
    const limitMs = Number(env.CW_DOCTOR_CONFORMANCE_TIMEOUT_MS) > 0 ? Number(env.CW_DOCTOR_CONFORMANCE_TIMEOUT_MS) : 180000;
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-conformance-")));
    const workerDir = path.join(root, "worker");
    const resultPath = path.join(workerDir, "result.md");
    const inputPath = path.join(workerDir, "input.md");
    const manifestPath = path.join(workerDir, "manifest.json");
    try {
        fs.mkdirSync(workerDir, { recursive: true });
        fs.writeFileSync(inputPath, CONFORMANCE_PROMPT, "utf8");
        fs.writeFileSync(manifestPath, `${JSON.stringify({ protocol: AGENT_PROTOCOL, workerId: "conformance", inputPath, resultPath, prompt: CONFORMANCE_PROMPT }, null, 2)}\n`, "utf8");
        const started = Date.now();
        const envelope = runBackend({
            schemaVersion: 1,
            backendId: "agent",
            cwd: workerDir,
            sandboxPolicy: resolveSandboxProfileById(undefined, sandboxContextForValidation(root)),
            manifest: { workerDir, manifestPath, inputPath, resultPath, prompt: CONFORMANCE_PROMPT },
            label: "conformance",
            timeoutMs: limitMs,
            delegation: { command: config.command, args: config.args, endpoint: config.endpoint, model: config.model },
        });
        const took = `${((Date.now() - started) / 1000).toFixed(1)}s`;
        if (envelope.status !== "completed") {
            const log = path.join(workerDir, "logs", "agent-stderr.log");
            const said = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 300) : "";
            return { name: "agent-conformance", status: "fail", detail: `${AGENT_PROTOCOL}: the agent did not end cleanly (${took}): ${envelope.result.summary}${said ? `; it said: ${said}` : ""}`, fix: FIX };
        }
        if (!fs.existsSync(resultPath)) {
            return { name: "agent-conformance", status: "fail", detail: `${AGENT_PROTOCOL}: the agent exited 0 in ${took} but wrote no result.md at {{result}}.`, fix: FIX };
        }
        let summary;
        try {
            summary = normalizeResultEnvelope(fs.readFileSync(resultPath, "utf8")).summary;
        }
        catch (error) {
            return { name: "agent-conformance", status: "fail", detail: `${AGENT_PROTOCOL}: result.md was written but CW cannot read it: ${error instanceof Error ? error.message : String(error)}`, fix: FIX };
        }
        const model = String(envelope.provenance.handle?.metadata?.reportedModel || "unreported");
        const followed = summary.includes(CONFORMANCE_MARKER) ? "" : " (the answer did not follow the fixed text, but CW could read it)";
        if (model === "unreported") {
            return {
                name: "agent-conformance",
                status: "warn",
                detail: `${AGENT_PROTOCOL}: ran in ${took}, exit 0, result.md read; no model reported, so run records will say "unreported"${followed}.`,
                fix: 'Have the agent print one JSON line on stdout with "model" (and "usage" if it has one), as the bundled wrappers do.',
            };
        }
        return { name: "agent-conformance", status: "ok", detail: `${AGENT_PROTOCOL}: ran in ${took}, exit 0, result.md read, model ${model.slice(0, 80)}${followed}.` };
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

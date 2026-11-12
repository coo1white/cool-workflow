// shell/execution-backend/agent.ts — runs the operator's agent CLI for one
// worker. CW never calls a model itself: it spawns the configured command
// argv-style (shell: false), waits, and reads what the agent wrote.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agentCommandArgv, messageOf, NETWORK_ENV_NAMES, substituteAgentArg } from "../../core/util/cli-args.js";
import { buildChildEnv, CW_NEVER_FORWARD_ENV } from "./local.js";
import { hostSpawnArgv } from "../fs-atomic.js";
const PROVIDER_KEY_ENV_RE = /^(CW_|ANTHROPIC_|CLAUDE_|OPENAI_|GEMINI_|DEEPSEEK_|CODEX_|GOOGLE_|COHERE_|MISTRAL_|OLLAMA_|AZURE_|AWS_)/i;
/** PATH and HOME, provider-key and proxy env, and USER (a vendor CLI reads it
 *  to find its own login in headless mode). Never a CW secret. */
export function buildAgentChildEnv(baseEnv = process.env) {
    const env = buildChildEnv(baseEnv);
    const forwarded = [];
    for (const key of Object.keys(baseEnv)) {
        if (CW_NEVER_FORWARD_ENV.has(key))
            continue;
        if (PROVIDER_KEY_ENV_RE.test(key) || NETWORK_ENV_NAMES.has(key)) {
            env[key] = baseEnv[key];
            forwarded.push(key);
        }
    }
    if (baseEnv.USER !== undefined && env.USER === undefined) {
        env.USER = baseEnv.USER;
        forwarded.push("USER");
    }
    return { env, forwarded };
}
const SECRET_FLAGS = new Set(["--api-key", "--apikey", "--token", "--key", "--secret", "--password", "--auth", "--bearer"]);
/** Redact secrets from recorded args: the value after a secret flag, an
 *  inline `--x-key=...`, or a token that looks like a credential. */
export function stripSecretArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = String(args[i]);
        if (SECRET_FLAGS.has(arg.toLowerCase())) {
            out.push(arg);
            if (i + 1 < args.length) {
                out.push("<redacted>");
                i++;
            }
            continue;
        }
        const inline = arg.match(/^(--?[A-Za-z][\w-]*(?:key|token|secret|password|auth|bearer)[\w-]*)=.*/i);
        if (inline)
            out.push(`${inline[1]}=<redacted>`);
        else if (/^(sk-|ghp_|gho_|github_pat_|xox[abpr]-|Bearer\s)/.test(arg) || (arg.length >= 32 && /^[A-Za-z0-9_-]{32,}$/.test(arg)))
            out.push("<redacted>");
        else
            out.push(arg);
    }
    return out;
}
export function parseAgentReport(stdout) {
    const text = String(stdout || "").trim();
    if (!text)
        return {};
    const tryObj = (value) => {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    };
    const lastLine = text.split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{") && line.trim().endsWith("}"));
    const obj = tryObj(text) || (lastLine ? tryObj(lastLine.trim()) : undefined);
    if (!obj)
        return {};
    const usage = obj.usage && typeof obj.usage === "object" ? obj.usage : undefined;
    let model = typeof obj.model === "string" ? obj.model : usage && typeof usage.model === "string" ? usage.model : typeof obj.modelId === "string" ? obj.modelId : undefined;
    if (!model && obj.modelUsage && typeof obj.modelUsage === "object" && !Array.isArray(obj.modelUsage)) {
        const tokens = (value) => {
            const r = (value && typeof value === "object" ? value : {});
            const n = Number(r.inputTokens ?? r.input_tokens ?? 0);
            return Number.isFinite(n) ? n : 0;
        };
        const entries = Object.entries(obj.modelUsage).sort((a, b) => tokens(b[1]) - tokens(a[1]));
        if (entries.length)
            model = entries[0][0];
    }
    const usageSignature = typeof obj.usageSignature === "string" ? obj.usageSignature : typeof obj.usage_signature === "string" ? obj.usage_signature : undefined;
    return { model, usage, usageSignature };
}
/** Kill the vendor process a shipped wrapper recorded (CW_AGENT_VENDOR_PIDFILE)
 *  after CW killed the wrapper on a timeout. Best effort. */
export function reapRecordedVendor(pidFile) {
    let raw;
    try {
        raw = fs.readFileSync(pidFile, "utf8");
    }
    catch {
        return false;
    }
    fs.rmSync(pidFile, { force: true });
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 1)
        return false;
    try {
        process.kill(pid, "SIGKILL");
        return true;
    }
    catch {
        return false;
    }
}
/** Keep a failed agent's stderr at <workerDir>/logs/agent-stderr.log
 *  (redacted, last 4096 bytes). A log the wrapper wrote itself wins. */
function persistAgentStderr(workerDir, stderr) {
    let text = stderr.trim();
    if (!text)
        return;
    try {
        const file = path.join(workerDir, "logs", "agent-stderr.log");
        if (fs.existsSync(file))
            return;
        text = text.replace(/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bprs]-[A-Za-z0-9-]{20,}|Bearer\s+\S+|Authorization:\s*\S+|api[_-]?key[=:]\s*\S+|token[=:]\s*\S+)/gi, (m) => m.slice(0, 4) + "***[REDACTED]");
        const cap = 4096;
        if (text.length > cap)
            text = text.slice(text.length - cap) + `\n  [cut to the last ${cap} of ${text.length} bytes]`;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${text}\n`, "utf8");
    }
    catch {
        /* diagnostics never break the run */
    }
}
const STDOUT_CAP = 32 * 1024 * 1024;
/** A wrapper that streams its agent's live view to the terminal holds this
 *  file (CW_DRIVE_TTY_CLAIM); the drive's still-working line keeps quiet then. */
export function driveTtyClaimPath() {
    return path.join(os.tmpdir(), `cw-drive-tty-${process.pid}.claim`);
}
export function runAgent(config, job) {
    const { binary, args: rawArgs } = agentCommandArgv(String(config.command), config.args);
    const subst = {
        manifest: path.join(job.workerDir, "manifest.json"),
        input: job.inputPath,
        result: job.resultPath,
        workerDir: job.workerDir,
        model: config.model || "",
        prompt: job.prompt,
        phase: job.phase,
        taskId: job.taskId,
        workerId: job.workerId,
    };
    if (rawArgs.some((arg) => arg.includes("{{priorResults}}"))) {
        subst.priorResults = path.join(job.workerDir, "prior-results.json");
        fs.writeFileSync(subst.priorResults, `${JSON.stringify({ schemaVersion: 1, taskId: job.taskId, phase: job.phase, priorResults: job.priorResults }, null, 2)}\n`);
    }
    const args = rawArgs.map((arg) => substituteAgentArg(arg, subst));
    const recorded = stripSecretArgs(args);
    const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : 600000;
    const pidFile = path.join(os.tmpdir(), `cw-agent-vendor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`);
    const env = { ...buildAgentChildEnv().env, CW_AGENT_VENDOR_PIDFILE: pidFile, ...(job.streamStderr ? { CW_DRIVE_TTY_CLAIM: driveTtyClaimPath() } : {}) };
    const done = (fields) => ({ exitCode: null, stdout: "", command: binary, args: recorded, ...fields });
    return new Promise((resolve) => {
        let child;
        try {
            const start = hostSpawnArgv(binary, args, env);
            child = spawn(start.binary, start.args, { cwd: job.cwd, env, shell: false, stdio: ["ignore", "pipe", job.streamStderr ? "inherit" : "pipe"], windowsHide: true });
        }
        catch (error) {
            resolve(done({ ok: false, reason: `agent process failed to spawn: ${messageOf(error)}` }));
            return;
        }
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        child.stdout?.on("data", (chunk) => {
            job.onOutput?.();
            if (stdout.length < STDOUT_CAP)
                stdout += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk) => {
            job.onOutput?.();
            stderr = (stderr + chunk.toString("utf8")).slice(-65536);
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve(done({ ok: false, reason: `agent process failed to spawn: ${messageOf(error)}` }));
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reapRecordedVendor(pidFile);
                persistAgentStderr(job.workerDir, stderr);
                resolve(done({ ok: false, reason: `agent process timed out after ${timeoutMs}ms and was killed (SIGKILL)`, timedOutMs: timeoutMs, stdout }));
                return;
            }
            fs.rmSync(pidFile, { force: true });
            if (code !== 0) {
                persistAgentStderr(job.workerDir, stderr);
                resolve(done({ ok: false, exitCode: code, stdout, reason: code === null ? "agent process returned no exit code (killed)" : `${job.taskId}: failed (exit ${code})` }));
                return;
            }
            resolve(done({ ok: true, exitCode: 0, stdout }));
        });
    });
}

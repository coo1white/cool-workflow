// shell/receipt-io.ts — `cw check`'s impure half: run the user's command (argv, shell:false),
// read git, keep receipts in <repo>/.cw/receipts/. It records output (digests, a tail), never
// parses it. Loaded lazily: only `cw check` and a result citing `receipt:<id>` pay for it.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { judgeReceipt, RECEIPT_ID_RE, sealReceipt, signReceipt } from "../core/trust/receipt.js";
import { resolveTrustPublicKey } from "../core/trust/telemetry-attestation.js";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../core/version.js";
import { writeJson } from "./fs-atomic.js";
import { recordTrustAuditEvent } from "./trust-audit.js";
const TAIL_BYTES = 4096;
const TAIL_LINES = 20;
const EXCLUDE_CW = ":(exclude).cw";
export function receiptsDir(repo) {
    return path.join(path.resolve(repo), ".cw", "receipts");
}
function git(repo, args) {
    try {
        return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 512 * 1024 * 1024 });
    }
    catch {
        return undefined;
    }
}
/** HEAD plus a digest of every uncommitted change under the repo folder
 *  (tracked diff + untracked, not ignored, files), leaving out .cw/. */
export function readCodeState(repo) {
    const head = git(repo, ["rev-parse", "--verify", "-q", "HEAD"])?.trim();
    if (!head)
        return { gitHead: null, treeDigest: null, dirty: false };
    const status = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", EXCLUDE_CW]);
    if (status === undefined)
        return { gitHead: head, treeDigest: null, dirty: false };
    const hash = createHash("sha256");
    const parts = status.split("\0").filter(Boolean);
    if (parts.length) {
        hash.update(git(repo, ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-color", "--", ".", EXCLUDE_CW]) ?? "diff-unreadable");
        const prefix = git(repo, ["rev-parse", "--show-prefix"])?.trim() || "";
        for (let i = 0; i < parts.length; i += 1) {
            const entry = parts[i];
            if (entry[0] === "R" || entry[0] === "C")
                i += 1;
            if (!entry.startsWith("?? "))
                continue;
            const rel = entry.slice(3);
            const file = path.join(repo, path.relative(prefix, rel));
            hash.update(`\0${rel}\0${untrackedBytesDigest(file)}`);
        }
    }
    return { gitHead: head, treeDigest: `sha256:${hash.digest("hex")}`, dirty: parts.length > 0 };
}
function untrackedBytesDigest(file) {
    try {
        const stat = fs.lstatSync(file);
        const bytes = stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file);
        return createHash("sha256").update(bytes).digest("hex");
    }
    catch {
        return "unreadable";
    }
}
class StreamTap {
    hash = createHash("sha256");
    bytes = 0;
    tail = Buffer.alloc(0);
    add(chunk) {
        this.hash.update(chunk);
        this.bytes += chunk.length;
        this.tail = Buffer.concat([this.tail, chunk]);
        if (this.tail.length > TAIL_BYTES)
            this.tail = this.tail.subarray(this.tail.length - TAIL_BYTES);
    }
    record() {
        const lines = this.tail.toString("utf8").replace(/\r\n/g, "\n").split("\n");
        if (lines.length && lines[lines.length - 1] === "")
            lines.pop();
        return { sha256: `sha256:${this.hash.digest("hex")}`, bytes: this.bytes, tail: lines.slice(-TAIL_LINES).join("\n").slice(-2000) };
    }
}
function readKey(value) {
    if (!value || !value.trim())
        return undefined;
    const text = value.includes("BEGIN") ? value : fs.existsSync(value) ? fs.readFileSync(value, "utf8") : undefined;
    if (!text)
        throw new Error(`CW_CHECK_PRIVKEY is set but no key could be read from it`);
    return text;
}
/** Run argv in the repo folder, no shell, and seal (and sign, when
 *  CW_CHECK_PRIVKEY is set) a receipt. A command that cannot start is an
 *  error, not a receipt. */
export function runCheck(argv, options) {
    const repo = path.resolve(options.repo);
    const env = options.env || process.env;
    const privateKey = readKey(env.CW_CHECK_PRIVKEY);
    const code = readCodeState(repo);
    const out = new StreamTap();
    const err = new StreamTap();
    const startedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
        const childEnv = { ...env };
        delete childEnv.CW_CHECK_PRIVKEY;
        const child = spawn(argv[0], argv.slice(1), { cwd: repo, shell: false, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
        const tee = (tap) => (chunk) => {
            tap.add(chunk);
            if (options.echo)
                process.stderr.write(chunk);
        };
        child.stdout.on("data", tee(out));
        child.stderr.on("data", tee(err));
        child.on("error", (error) => {
            reject(new Error(error.code === "ENOENT" ? `command not found: ${argv[0]} (cw check runs it with no shell; give a program on PATH, for one: cw check -- npm test)` : `cannot start ${argv[0]}: ${error.message}`));
        });
        child.on("close", (exitCode, signal) => {
            let receipt = sealReceipt({
                kind: "check-receipt",
                schemaVersion: 1,
                argv: [...argv],
                cwd: repo,
                gitHead: code.gitHead,
                dirty: code.dirty,
                treeDigest: code.treeDigest,
                exitCode: signal ? null : exitCode,
                signal: signal || null,
                startedAt,
                endedAt: new Date().toISOString(),
                stdout: out.record(),
                stderr: err.record(),
                cwVersion: CURRENT_COOL_WORKFLOW_VERSION,
            });
            if (privateKey)
                receipt = signReceipt(receipt, privateKey);
            resolve(receipt);
        });
    });
}
/** Write once: the file name is the content id, so an existing file is kept. */
export function saveReceipt(repo, receipt) {
    const file = path.join(receiptsDir(repo), `${receipt.id}.json`);
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        writeJson(file, receipt);
    }
    return file;
}
function readRaw(file) {
    if (!fs.existsSync(file))
        return undefined;
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return {};
    }
}
/** The stored receipt (parsed, NOT yet checked), or undefined. Looks in
 *  the repo store, then in the run's own pinned copies. */
export function loadReceipt(repo, id, runDir) {
    if (!RECEIPT_ID_RE.test(id))
        return undefined;
    const found = readRaw(path.join(receiptsDir(repo), `${id}.json`));
    return found !== undefined || !runDir ? found : readRaw(path.join(runDir, "receipts", `${id}.json`));
}
export function checkPublicKey(env = process.env) {
    return resolveTrustPublicKey(env.CW_CHECK_PUBKEY);
}
export function judgeStoredReceipt(repo, id, code = readCodeState(repo), runDir) {
    return judgeReceipt(id, loadReceipt(repo, id, runDir), code, checkPublicKey());
}
export function listReceipts(repo) {
    const dir = receiptsDir(repo);
    if (!fs.existsSync(dir))
        return [];
    const code = readCodeState(repo);
    const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => {
        const id = name.slice(0, -".json".length);
        const raw = loadReceipt(repo, id);
        const verdict = judgeReceipt(id, raw, code, checkPublicKey());
        return {
            id,
            argv: Array.isArray(raw?.argv) ? raw.argv : null,
            exitCode: typeof raw?.exitCode === "number" ? raw.exitCode : null,
            gitHead: typeof raw?.gitHead === "string" ? raw.gitHead : null,
            startedAt: typeof raw?.startedAt === "string" ? raw.startedAt : null,
            usable: verdict.ok,
            code: verdict.code || null,
            reason: verdict.reason,
            next: verdict.next,
        };
    });
    return entries.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || a.id.localeCompare(b.id));
}
/** The gate for a run: judge each cited receipt against the run's code
 *  now. On success the receipts are pinned into <runDir>/receipts/ (so the
 *  report and a bundle carry them) and one audit event is written. */
export function checkCitedReceipts(run, ids, context = {}) {
    const code = readCodeState(run.cwd);
    const verdicts = ids.map((id) => judgeStoredReceipt(run.cwd, id, code, run.paths.runDir));
    const refused = verdicts.filter((v) => !v.ok);
    if (refused.length)
        return refused;
    for (const id of ids) {
        const pinned = path.join(run.paths.runDir, "receipts", `${id}.json`);
        if (!fs.existsSync(pinned)) {
            fs.mkdirSync(path.dirname(pinned), { recursive: true });
            writeJson(pinned, loadReceipt(run.cwd, id, run.paths.runDir));
        }
    }
    if (context.taskId) {
        recordTrustAuditEvent(run, { kind: "receipt.check", decision: "accepted", source: "cw-validated", taskId: context.taskId, workerId: context.workerId, evidenceRefs: ids.map((id) => `receipt:${id}`), metadata: { gitHead: code.gitHead } });
    }
    return [];
}
/** A run's pinned receipts as report lines (reads files only; never git). */
export function pinnedReceiptLines(runDir) {
    const dir = path.join(runDir, "receipts");
    if (!fs.existsSync(dir))
        return [];
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => {
        const id = name.slice(0, -".json".length);
        return `- ${id}: ${pinnedReceiptNote(runDir, id)}`;
    });
}
export function pinnedReceiptNote(runDir, id) {
    const raw = readRaw(path.join(runDir, "receipts", `${id}.json`));
    const verdict = judgeReceipt(id, raw, { gitHead: raw?.gitHead ?? null, treeDigest: raw?.treeDigest ?? null });
    if (!verdict.ok)
        return `NOT verified: ${verdict.reason}`;
    return `${verdict.reason}: ${raw.argv.join(" ")}`;
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCostPolicy = loadCostPolicy;
exports.parseUsageFromArgs = parseUsageFromArgs;
// Intake helpers for observability — POLICY as DATA and host-attested usage
// parsing, kept out of the kernel. Pure/IO-edge functions carved out of
// observability.ts (god-module carve) so the metrics module no longer bundles
// the CLI/MCP argument-intake layer. Re-exported from observability.ts to keep
// the public surface byte-unchanged.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
/** Resolve a CostPolicy from CLI/MCP args. `--pricing <path>` loads a policy
 *  file; `--pricing default|bundled` loads the bundled example under
 *  manifest/pricing.policy.json. Absent ⇒ undefined ⇒ cost is `unpriced`/
 *  `unreported`, never guessed. */
function loadCostPolicy(args, pluginRoot) {
    const raw = args.pricing ?? args.pricingPolicy ?? args.policy;
    if (raw === undefined || raw === null || raw === "")
        return undefined;
    const value = String(raw);
    const file = value === "default" || value === "bundled"
        ? node_path_1.default.join(pluginRoot, "manifest", "pricing.policy.json")
        : node_path_1.default.resolve(value);
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`Pricing policy file not found: ${file}`);
    const parsed = (0, state_1.readJson)(file);
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.models)) {
        throw new Error(`Invalid pricing policy (expected schemaVersion 1 + models[]): ${file}`);
    }
    return parsed;
}
/** Parse a host-attested UsageRecord from CLI/MCP intake args. Returns undefined
 *  when NO usage was provided (⇒ `unreported`). CW never fabricates usage, so a
 *  caller that passes nothing gets nothing. */
function parseUsageFromArgs(args, now) {
    const inline = args.usage;
    if (inline && typeof inline === "object" && !Array.isArray(inline)) {
        return normalizeUsage(inline, now);
    }
    const input = numeric(args.usageInputTokens ?? args["usage-input-tokens"]);
    const output = numeric(args.usageOutputTokens ?? args["usage-output-tokens"]);
    const model = args.usageModel ?? args["usage-model"];
    const total = numeric(args.usageTotalTokens ?? args["usage-total-tokens"]);
    const cacheRead = numeric(args.usageCacheReadTokens ?? args["usage-cache-read-tokens"]);
    const cacheWrite = numeric(args.usageCacheWriteTokens ?? args["usage-cache-write-tokens"]);
    if (input === undefined && output === undefined && total === undefined && model === undefined) {
        return undefined;
    }
    return normalizeUsage({
        source: args.usageSource ?? args["usage-source"],
        model,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        attestedAt: args.usageAttestedAt ?? args["usage-attested-at"],
        note: args.usageNote ?? args["usage-note"]
    }, now);
}
function normalizeUsage(raw, now) {
    const source = raw.source === "operator-recorded" ? "operator-recorded" : "host-attested";
    const usage = {
        schemaVersion: 1,
        source,
        attestedAt: typeof raw.attestedAt === "string" && raw.attestedAt ? raw.attestedAt : now
    };
    if (raw.model !== undefined && raw.model !== null && raw.model !== "")
        usage.model = String(raw.model);
    const input = numeric(raw.inputTokens);
    const output = numeric(raw.outputTokens);
    const total = numeric(raw.totalTokens);
    const cacheRead = numeric(raw.cacheReadTokens);
    const cacheWrite = numeric(raw.cacheWriteTokens);
    if (input !== undefined)
        usage.inputTokens = input;
    if (output !== undefined)
        usage.outputTokens = output;
    if (total !== undefined)
        usage.totalTokens = total;
    if (cacheRead !== undefined)
        usage.cacheReadTokens = cacheRead;
    if (cacheWrite !== undefined)
        usage.cacheWriteTokens = cacheWrite;
    if (raw.note !== undefined && raw.note !== null && raw.note !== "")
        usage.note = String(raw.note);
    return usage;
}
function numeric(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

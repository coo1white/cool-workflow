"use strict";
// shell/observability-intake.ts — POLICY as DATA + host-attested usage
// parsing for shell/observability.ts. Byte-exact port of the old build's
// src/observability/intake.ts.
//
// MILESTONE 11 (reporting/observability).
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
exports.loadCostPolicy = loadCostPolicy;
exports.parseUsageFromArgs = parseUsageFromArgs;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
/** Resolve a CostPolicy from CLI/MCP args. `--pricing <path>` loads a
 *  policy file; `--pricing default|bundled` loads the bundled example.
 *  Absent -> undefined -> cost is `unpriced`/`unreported`, never
 *  guessed. */
function loadCostPolicy(args, pluginRoot) {
    const raw = args.pricing ?? args.pricingPolicy ?? args.policy;
    if (raw === undefined || raw === null || raw === "")
        return undefined;
    const value = String(raw);
    const file = value === "default" || value === "bundled" ? path.join(pluginRoot, "manifest", "pricing.policy.json") : path.resolve(value);
    if (!fs.existsSync(file))
        throw new Error(`Pricing policy file not found: ${file}`);
    const parsed = (0, fs_atomic_1.readJson)(file);
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.models)) {
        throw new Error(`Invalid pricing policy (expected schemaVersion 1 + models[]): ${file}`);
    }
    return parsed;
}
function numeric(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function normalizeUsage(raw, now) {
    const source = raw.source === "operator-recorded" ? "operator-recorded" : "host-attested";
    const usage = { schemaVersion: 1, source, attestedAt: typeof raw.attestedAt === "string" && raw.attestedAt ? raw.attestedAt : now };
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
/** Parse a host-attested UsageRecord from CLI/MCP intake args. Returns
 *  undefined when NO usage was provided (-> `unreported`). CW never
 *  fabricates usage. */
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
    if (input === undefined && output === undefined && total === undefined && model === undefined)
        return undefined;
    return normalizeUsage({
        source: args.usageSource ?? args["usage-source"],
        model,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        attestedAt: args.usageAttestedAt ?? args["usage-attested-at"],
        note: args.usageNote ?? args["usage-note"],
    }, now);
}

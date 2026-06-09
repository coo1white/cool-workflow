"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGroundedEvidence = isGroundedEvidence;
exports.hasGroundedEvidence = hasGroundedEvidence;
exports.requireResolvableEvidence = requireResolvableEvidence;
exports.resolveEvidenceLocator = resolveEvidenceLocator;
exports.unresolvedFileEvidence = unresolvedFileEvidence;
exports.computeEvidenceConfidence = computeEvidenceConfidence;
exports.computeEvidenceConfidenceTiers = computeEvidenceConfidenceTiers;
exports.maxEvidenceConfidence = maxEvidenceConfidence;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
// ---------------------------------------------------------------------------
// Evidence grounding (v0.1.40 self-audit P1).
//
// The flagship "evidence-gated commit" used to accept ANY non-empty string as
// evidence (`verifier.ts` checked only `.some(entry => entry.trim())`). That made
// the gate trust-on-self-report: an agent could pass it with `evidence: ["x"]`.
//
// CW's evidence is a deliberately free-form LOCATOR namespace — `file:line`,
// URLs, and machine tokens like `exitCode:0`, `stdoutSha256:<hash>`, `refused:<why>`
// are all legitimate — so we cannot require "must be a file that exists" by
// default without breaking cross-repo, URL, and runtime-token evidence. Instead:
//
//  1. DEFAULT (pure, deterministic): require evidence to be GROUNDED — a URL, a
//     path-like locator, or a `namespace:value` token. This rejects bare prose
//     ("x", "anything", "HIGH severity") while accepting every shape CW itself
//     emits. Being a pure function of the string, it is replay-safe.
//
//  2. OPT-IN (CW_REQUIRE_RESOLVABLE_EVIDENCE=1): additionally resolve path-like
//     locators against the run's base dirs and fail closed if a file locator does
//     not exist on disk. Off by default because the resolving cwd is context-
//     dependent; on for self-audit / compliance where evidence MUST be checkable.
// ---------------------------------------------------------------------------
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PATH_SEP_RE = /[\\/]/;
const FILE_EXT_RE = /\.[A-Za-z0-9]{1,12}(?::\d+(?:-\d+)?)?$/;
const NAMESPACE_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.-]*:\S/;
const LINE_SUFFIX_RE = /:(\d+(?:-\d+)?)$/;
/** A single evidence string is "grounded" if it is machine-shaped — a URL, a
 *  path-like locator, or a `namespace:value` token — rather than free prose. */
function isGroundedEvidence(raw) {
    const value = String(raw ?? "").trim();
    if (!value)
        return false;
    if (URL_RE.test(value))
        return true;
    if (PATH_SEP_RE.test(value))
        return true;
    if (FILE_EXT_RE.test(value))
        return true;
    if (NAMESPACE_TOKEN_RE.test(value))
        return true;
    return false;
}
/** An evidence array passes the gate if at least one entry is grounded. */
function hasGroundedEvidence(evidence) {
    return Array.isArray(evidence) && evidence.some((entry) => isGroundedEvidence(entry));
}
/** Whether opt-in strict resolution is requested via the environment. */
function requireResolvableEvidence() {
    return /^(1|true|yes|on)$/i.test(process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE || "");
}
function classify(raw) {
    const value = raw.trim();
    if (!value)
        return { kind: "opaque" };
    if (URL_RE.test(value))
        return { kind: "url" };
    const line = value.match(LINE_SUFFIX_RE);
    const pathPart = line ? value.slice(0, value.length - line[0].length) : value;
    const looksFile = (PATH_SEP_RE.test(pathPart) || FILE_EXT_RE.test(value)) && !/\s/.test(pathPart);
    return looksFile ? { kind: "file", pathPart } : { kind: "opaque" };
}
/** Resolve one locator against base dirs (used only in strict mode). */
function resolveEvidenceLocator(raw, baseDirs) {
    const shape = classify(raw);
    if (shape.kind === "url")
        return "external";
    if (shape.kind === "opaque" || !shape.pathPart)
        return "opaque";
    const candidates = node_path_1.default.isAbsolute(shape.pathPart)
        ? [shape.pathPart]
        : baseDirs.filter(Boolean).map((base) => node_path_1.default.resolve(base, shape.pathPart));
    for (const candidate of candidates) {
        try {
            node_fs_1.default.statSync(candidate);
            return "resolved";
        }
        catch {
            /* try next base */
        }
    }
    return "unresolved";
}
/** In strict mode, the file-style locators that could NOT be resolved on disk.
 *  Returns [] when strict mode is off or all file locators resolve. */
function unresolvedFileEvidence(evidence, baseDirs) {
    if (!requireResolvableEvidence() || !Array.isArray(evidence))
        return [];
    return evidence
        .map((entry) => String(entry))
        .filter((entry) => resolveEvidenceLocator(entry, baseDirs) === "unresolved");
}
/** Compute the confidence tier for a single evidence string. Deterministic:
 *  pure function of the string and optional base dirs for resolution. */
function computeEvidenceConfidence(raw, baseDirs) {
    if (!isGroundedEvidence(raw))
        return "ungrounded";
    if (!baseDirs || !baseDirs.length || !requireResolvableEvidence())
        return "grounded";
    const value = String(raw).trim();
    const shape = classify(value);
    if (shape.kind === "url")
        return "grounded"; // URLs not resolved yet
    if (shape.kind === "opaque")
        return "grounded"; // namespace:value tokens are grounded
    // File-style: try resolution
    const resolution = resolveEvidenceLocator(value, baseDirs);
    return resolution === "resolved" ? "resolvable" : "grounded";
}
/** Compute confidence tiers for an array of evidence entries. */
function computeEvidenceConfidenceTiers(evidence, baseDirs) {
    if (!Array.isArray(evidence))
        return [];
    return evidence.map((entry) => computeEvidenceConfidence(entry, baseDirs));
}
/** The highest confidence tier in an evidence array. Used for gate decisions. */
function maxEvidenceConfidence(evidence, baseDirs) {
    const tiers = computeEvidenceConfidenceTiers(evidence, baseDirs);
    if (!tiers.length)
        return "ungrounded";
    const order = ["ungrounded", "grounded", "resolvable", "verified"];
    let max = "ungrounded";
    for (const tier of tiers) {
        if (order.indexOf(tier) > order.indexOf(max))
            max = tier;
    }
    return max;
}

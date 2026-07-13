"use strict";
// core/trust/evidence-grounding.ts — isGroundedEvidence, confidence tiers,
// extractEvidenceContent's PURE decision half.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/evidence-grounding.ts, split so this file stays pure (no fs):
// resolution against real disk paths takes a caller-supplied
// `pathExists`/`readFile`, matching the core/shell split. Real callers
// (shell/) pass `fs.existsSync`/`fs.readFileSync`.
//
// Evidence: SPEC/pipeline-run.md "Result ingest — src/result-normalize.ts"
// (isGroundedEvidence is its evidence-classification primitive);
// plugins/cool-workflow/src/evidence-grounding.ts (byte-exact source).
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGroundedEvidence = isGroundedEvidence;
exports.hasGroundedEvidence = hasGroundedEvidence;
exports.requireResolvableEvidence = requireResolvableEvidence;
exports.resolveEvidenceLocator = resolveEvidenceLocator;
exports.unresolvedFileEvidence = unresolvedFileEvidence;
exports.computeEvidenceConfidence = computeEvidenceConfidence;
exports.extractEvidenceContent = extractEvidenceContent;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PATH_SEP_RE = /[\\/]/;
const FILE_EXT_RE = /\.[A-Za-z0-9]{1,12}(?::\d+(?:-\d+)?)?$/;
const NAMESPACE_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.-]*:\S/;
const LINE_SUFFIX_RE = /:(\d+(?:-\d+)?)$/;
/** A single evidence string is "grounded" if it is machine-shaped — a
 *  URL, a path-like locator, or a `namespace:value` token — rather than
 *  free prose. */
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
/** Whether opt-in strict resolution is requested via the environment.
 *  Enabled by DEFAULT: file-style evidence locators MUST exist on disk.
 *  `CW_REQUIRE_RESOLVABLE_EVIDENCE=0` restores the prior shape-only
 *  check. */
function requireResolvableEvidence(env = process.env) {
    const raw = env.CW_REQUIRE_RESOLVABLE_EVIDENCE;
    if (raw === undefined || raw === null || raw === "")
        return true;
    if (/^(0|false|no|off)$/i.test(raw))
        return false;
    return true;
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
/** Resolve one locator against base dirs (used only in strict mode).
 *  `resolve(candidatePath)` is caller-supplied (real fs.existsSync in
 *  shell/), matching the core/shell split — this pure module never
 *  imports fs itself. */
function resolveEvidenceLocator(raw, baseDirs, exists, isAbsolute, resolvePath) {
    const shape = classify(raw);
    if (shape.kind === "url")
        return "external";
    if (shape.kind === "opaque" || !shape.pathPart)
        return "opaque";
    const candidates = isAbsolute(shape.pathPart) ? [shape.pathPart] : baseDirs.filter(Boolean).map((base) => resolvePath(base, shape.pathPart));
    for (const candidate of candidates) {
        if (exists(candidate))
            return "resolved";
    }
    return "unresolved";
}
/** In strict mode, the file-style locators that could NOT be resolved on
 *  disk. Returns [] when strict mode is off or all file locators
 *  resolve. */
function unresolvedFileEvidence(evidence, baseDirs, ops, env = process.env) {
    if (!requireResolvableEvidence(env) || !Array.isArray(evidence))
        return [];
    return evidence.map((entry) => String(entry)).filter((entry) => resolveEvidenceLocator(entry, baseDirs, ops.exists, ops.isAbsolute, ops.resolve) === "unresolved");
}
/** Compute the confidence tier for a single evidence string. */
function computeEvidenceConfidence(raw, baseDirs, ops, env = process.env) {
    if (!isGroundedEvidence(raw))
        return "ungrounded";
    if (!baseDirs || !baseDirs.length || !ops || !requireResolvableEvidence(env))
        return "grounded";
    const value = String(raw).trim();
    const shape = classify(value);
    if (shape.kind === "url")
        return "grounded";
    if (shape.kind === "opaque")
        return "grounded";
    const resolution = resolveEvidenceLocator(value, baseDirs, ops.exists, ops.isAbsolute, ops.resolve);
    return resolution === "resolved" ? "resolvable" : "grounded";
}
/** Extract actual content from a file-style evidence locator. Never
 *  fabricates: returns undefined when the file doesn't exist or the
 *  locator is not file-style. Lines are 1-indexed. `readFile` is
 *  caller-supplied (real fs.readFileSync in shell/). */
function extractEvidenceContent(locator, baseDirs, ops, readFile) {
    const shape = classify(locator);
    if (shape.kind !== "file" || !shape.pathPart)
        return undefined;
    // Match the same shapes LINE_SUFFIX_RE (classify) accepts: ":<n>" and
    // ":<n>-<m>". A range that only matched classify used to fall through to
    // the head-of-file slice below — returning bytes that had nothing to do
    // with the cited lines.
    const lineMatch = locator.match(/:(\d+)(?:-(\d+))?$/);
    const lineNum = lineMatch ? Number(lineMatch[1]) : undefined;
    const lineEnd = lineMatch && lineMatch[2] ? Number(lineMatch[2]) : undefined;
    const candidatePath = ops.isAbsolute(shape.pathPart)
        ? shape.pathPart
        : baseDirs.filter(Boolean).map((base) => ops.resolve(base, shape.pathPart)).find((p) => ops.exists(p));
    if (!candidatePath)
        return undefined;
    const content = readFile(candidatePath);
    if (content === undefined)
        return undefined;
    if (lineNum && lineNum > 0) {
        const lines = content.split("\n");
        if (lineEnd !== undefined) {
            // Range: return exactly the cited lines; a backwards or out-of-range
            // span returns undefined, never fabricated content.
            if (lineEnd < lineNum || lineNum > lines.length)
                return undefined;
            return lines.slice(lineNum - 1, Math.min(lineEnd, lines.length)).join("\n") || undefined;
        }
        return lines[lineNum - 1] || undefined;
    }
    return content.slice(0, 200);
}

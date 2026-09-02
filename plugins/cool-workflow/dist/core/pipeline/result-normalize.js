"use strict";
// core/pipeline/result-normalize.ts — normalizeResultEnvelope,
// isEmptyCapture.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// result-normalize module. Pure (no fs/clock/random).
//
// Evidence: SPEC/pipeline-run.md "Result ingest — result-normalize module".
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeResultEnvelope = normalizeResultEnvelope;
exports.firstNonEmptyLine = firstNonEmptyLine;
exports.isEmptyCapture = isEmptyCapture;
const evidence_grounding_1 = require("../trust/evidence-grounding");
const FINDING_ARRAY_KEYS = [
    "findings",
    "candidate_risks",
    "candidateRisks",
    "risks",
    "ranked_risks",
    "rankedRisks",
    "top_risks",
    "topRisks",
    "issues",
    "problems",
    "concerns",
];
const FINDING_EVIDENCE_KEYS = ["evidence", "evidence_paths", "evidencePaths", "locators", "refs", "files", "location", "locations", "path", "paths", "line", "lines", "where"];
const CLASSIFICATIONS = new Set(["real", "conditional", "non-issue", "unknown"]);
const TOP_LEVEL_EVIDENCE_CAP = 256;
const PER_FINDING_EVIDENCE_CAP = 32;
function normalizeResultEnvelope(markdown) {
    const match = markdown.match(/```cw:result\s*([\s\S]*?)```/);
    if (!match) {
        return { summary: firstNonEmptyLine(markdown), findings: [], evidence: harvestGrounded([markdown], TOP_LEVEL_EVIDENCE_CAP) };
    }
    let parsed;
    try {
        parsed = JSON.parse(match[1]);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid cw:result JSON: ${message}`);
    }
    const summary = pickString(parsed, ["summary", "short_answer", "shortAnswer", "verdict", "answer", "conclusion"]) || firstNonEmptyLine(markdown);
    const canonicalFindings = Array.isArray(parsed.findings) ? parsed.findings : undefined;
    const rawFindings = (canonicalFindings && canonicalFindings.length ? canonicalFindings : extractFindingsRaw(parsed)) ?? [];
    const findings = rawFindings.map((item, index) => normalizeFinding(item, index));
    const canonicalEvidence = Array.isArray(parsed.evidence) ? parsed.evidence : undefined;
    const evidence = canonicalEvidence && canonicalEvidence.length ? canonicalEvidence : harvestGrounded([parsed, findings, stripFence(markdown)], TOP_LEVEL_EVIDENCE_CAP);
    return { summary, findings, evidence };
}
function extractFindingsRaw(parsed) {
    for (const key of FINDING_ARRAY_KEYS) {
        if (key === "findings")
            continue;
        const raw = parsed[key];
        if (Array.isArray(raw) && raw.length)
            return raw;
    }
    return undefined;
}
function normalizeFinding(item, index) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item;
        const id = pickString(obj, ["id", "key", "name", "title"]) || `finding-${index + 1}`;
        const classification = normalizeClassification(pickString(obj, ["classification", "class", "kind", "status"]));
        const severity = normalizeSeverity(pickString(obj, ["severity", "priority", "level", "rank", "rating"]));
        const explicit = harvestGrounded(FINDING_EVIDENCE_KEYS.map((k) => obj[k]).filter((v) => v !== undefined), PER_FINDING_EVIDENCE_CAP);
        const evidence = explicit.length ? explicit : harvestGrounded([obj], PER_FINDING_EVIDENCE_CAP);
        return { id, classification: classification ?? "unknown", severity, evidence };
    }
    const text = String(item ?? "");
    return {
        id: `finding-${index + 1}`,
        classification: "unknown",
        severity: normalizeSeverity(text),
        evidence: harvestGrounded([text], PER_FINDING_EVIDENCE_CAP),
    };
}
function normalizeClassification(value) {
    if (!value)
        return undefined;
    const v = value.trim().toLowerCase();
    if (CLASSIFICATIONS.has(v))
        return v;
    if (v.includes("non") && v.includes("issue"))
        return "non-issue";
    if (v === "confirmed" || v === "true" || v === "valid")
        return "real";
    if (v === "possible" || v === "maybe" || v === "potential")
        return "conditional";
    return "unknown";
}
function normalizeSeverity(value) {
    const s = String(value || "").toUpperCase();
    const tag = s.match(/\bP[0-3]\b/);
    if (tag)
        return tag[0];
    if (/CRIT|BLOCKER/.test(s))
        return "P0";
    if (/HIGH|SEV(ERE)?\b/.test(s))
        return "P1";
    if (/MED(IUM)?\b/.test(s))
        return "P2";
    if (/LOW|MINOR|NIT\b/.test(s))
        return "P3";
    return "none";
}
function harvestGrounded(values, cap = TOP_LEVEL_EVIDENCE_CAP) {
    const acc = [];
    for (const v of values)
        collect(v, acc);
    const unique = Array.from(new Set(acc.map((s) => s.trim()).filter(Boolean)));
    unique.sort();
    return unique.slice(0, cap);
}
function collect(value, acc) {
    if (value === null || value === undefined)
        return;
    if (typeof value === "string") {
        const v = value.trim();
        if (v && !/\s/.test(v) && (0, evidence_grounding_1.isGroundedEvidence)(v))
            acc.push(v);
        else
            for (const tok of locatorsFromText(v))
                acc.push(tok);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collect(item, acc);
        return;
    }
    if (typeof value === "object") {
        for (const item of Object.values(value))
            collect(item, acc);
    }
}
const LOCATOR_RE = /`([^`]+)`|([A-Za-z0-9_@./-]+\.[A-Za-z]{1,8}(?::\d+(?:-\d+)?)?)|(https?:\/\/[^\s)]+)/g;
function locatorsFromText(text) {
    const out = [];
    let m;
    LOCATOR_RE.lastIndex = 0;
    while ((m = LOCATOR_RE.exec(text))) {
        const tok = (m[1] || m[2] || m[3] || "").trim();
        if (tok && (0, evidence_grounding_1.isGroundedEvidence)(tok))
            out.push(tok);
    }
    return out;
}
function stripFence(markdown) {
    return markdown.replace(/```cw:result\s*[\s\S]*?```/g, "");
}
function pickString(obj, keys) {
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === "string" && v.trim())
            return v.trim();
    }
    return undefined;
}
function firstNonEmptyLine(markdown) {
    return (markdown
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#") && !line.startsWith("```")) || "");
}
/** True when an accepted result captured no structured signal at all. */
function isEmptyCapture(envelope) {
    return (envelope.findings?.length || 0) === 0 && (envelope.evidence?.length || 0) === 0;
}

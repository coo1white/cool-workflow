// Robust result ingest (v0.1.42 — value experiment).
//
// The v0.1.41 self-audit's live-drive test showed the real failure mode of the
// agent backend: a capable model produces excellent, line-cited analysis but
// emits it under its OWN keys (`candidate_risks`, `invariants`, …) or as prose,
// not CW's exact `{summary, findings, evidence}` schema — so CW captured ZERO
// findings/evidence and "accepted" it anyway. The auditability was theater.
//
// This module makes ingest robust WITHOUT trusting the agent to format CW's keys:
//   1. Canonical schema is honored verbatim (backward-compatible — when the agent
//      DOES emit non-empty `findings`/`evidence`, they pass through unchanged).
//   2. Otherwise CW extracts findings from any reasonable alternative key, and
//      DERIVES the evidence itself by harvesting GROUNDED locators (path:line /
//      URL / namespace:value — via evidence-grounding) from the whole JSON AND
//      the prose. CW stops trusting the agent's formatting and reads the content.
//
// Pure (string -> envelope): no fs, no clock, no randomness — replay-safe.
import { Finding, FindingClassification, ResultEnvelope, Severity } from "./types";
import { isGroundedEvidence } from "./evidence-grounding";

// Alternative keys a capable model naturally uses for the findings array.
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
  "concerns"
];
// Per-finding keys that may carry evidence locators.
const FINDING_EVIDENCE_KEYS = ["evidence", "evidence_paths", "evidencePaths", "locators", "refs", "files", "location", "locations", "path", "paths", "line", "lines", "where"];
const CLASSIFICATIONS = new Set(["real", "conditional", "non-issue", "unknown"]);
// Evidence caps (v0.1.42): the v0.1.41 experiment hit a single flat cap of 64 on
// the top-level union, silently dropping locators on richly-cited workers. The
// top-level array now holds the whole run's harvested locators (high cap), while
// each finding keeps a focused, readable set.
const TOP_LEVEL_EVIDENCE_CAP = 256;
const PER_FINDING_EVIDENCE_CAP = 32;

export function normalizeResultEnvelope(markdown: string): ResultEnvelope {
  const match = markdown.match(/```cw:result\s*([\s\S]*?)```/);
  if (!match) {
    // No fence: still DERIVE grounded evidence from the prose so a fence-less but
    // well-cited report is not silently captured as empty.
    return { summary: firstNonEmptyLine(markdown), findings: [], evidence: harvestGrounded([markdown], TOP_LEVEL_EVIDENCE_CAP) };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid cw:result JSON: ${message}`);
  }

  const summary =
    pickString(parsed, ["summary", "short_answer", "shortAnswer", "verdict", "answer", "conclusion"]) || firstNonEmptyLine(markdown);

  // Findings: prefer the canonical `findings` array, else the first present
  // alternative array. EVERY finding is then normalized (id guaranteed, severity/
  // classification coerced, evidence derived) so a capable agent that omits an `id`
  // or uses `high`/`candidate_risks` is captured rather than fail-closed-rejected.
  const canonicalFindings = Array.isArray(parsed.findings) ? (parsed.findings as unknown[]) : undefined;
  const rawFindings = (canonicalFindings && canonicalFindings.length ? canonicalFindings : extractFindingsRaw(parsed)) ?? [];
  const findings = rawFindings.map((item, index) => normalizeFinding(item, index));

  // Evidence: canonical non-empty wins; else CW derives grounded locators itself
  // from the entire envelope JSON, the findings, and the prose.
  const canonicalEvidence = Array.isArray(parsed.evidence) ? (parsed.evidence as string[]) : undefined;
  const evidence =
    canonicalEvidence && canonicalEvidence.length
      ? canonicalEvidence
      : harvestGrounded([parsed, findings, stripFence(markdown)], TOP_LEVEL_EVIDENCE_CAP);

  return { summary, findings, evidence };
}

/** The first recognized alternative findings array (raw items, normalized by the
 *  caller). Returns undefined when no alternative findings source is present. */
function extractFindingsRaw(parsed: Record<string, unknown>): unknown[] | undefined {
  for (const key of FINDING_ARRAY_KEYS) {
    if (key === "findings") continue; // canonical handled by the caller
    const raw = parsed[key];
    if (Array.isArray(raw) && raw.length) return raw;
  }
  return undefined;
}

function normalizeFinding(item: unknown, index: number): Finding {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    const id = pickString(obj, ["id", "key", "name", "title"]) || `finding-${index + 1}`;
    const classification = normalizeClassification(pickString(obj, ["classification", "class", "kind", "status"]));
    const severity = normalizeSeverity(pickString(obj, ["severity", "priority", "level", "rank", "rating"]));
    // Evidence: explicit per-finding evidence keys first, else derive grounded
    // locators from the whole finding object (so `{title, detail, file, line}` works).
    const explicit = harvestGrounded(FINDING_EVIDENCE_KEYS.map((k) => obj[k]).filter((v) => v !== undefined), PER_FINDING_EVIDENCE_CAP);
    const evidence = explicit.length ? explicit : harvestGrounded([obj], PER_FINDING_EVIDENCE_CAP);
    return { id, classification, severity, evidence };
  }
  // A bare string finding ("P1 — revoke stays live (app.ts:1644)").
  const text = String(item ?? "");
  return {
    id: `finding-${index + 1}`,
    classification: "unknown",
    severity: normalizeSeverity(text),
    evidence: harvestGrounded([text], PER_FINDING_EVIDENCE_CAP)
  };
}

function normalizeClassification(value: string | undefined): FindingClassification | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (CLASSIFICATIONS.has(v)) return v as FindingClassification;
  if (v.includes("non") && v.includes("issue")) return "non-issue";
  if (v === "confirmed" || v === "true" || v === "valid") return "real";
  if (v === "possible" || v === "maybe" || v === "potential") return "conditional";
  return "unknown";
}

function normalizeSeverity(value: string | undefined): Severity {
  const s = String(value || "").toUpperCase();
  const tag = s.match(/\bP[0-3]\b/);
  if (tag) return tag[0] as Severity;
  if (/CRIT|BLOCKER/.test(s)) return "P0";
  if (/HIGH|SEV(ERE)?\b/.test(s)) return "P1";
  if (/MED(IUM)?\b/.test(s)) return "P2";
  if (/LOW|MINOR|NIT\b/.test(s)) return "P3";
  return "none";
}

/** Collect GROUNDED locators (path:line / URL / namespace:value) from any mix of
 *  JSON values and prose strings. This is how CW derives evidence itself instead
 *  of trusting the agent's `evidence` key. Deterministic: deduped + sorted + capped. */
function harvestGrounded(values: unknown[], cap: number = TOP_LEVEL_EVIDENCE_CAP): string[] {
  const acc: string[] = [];
  for (const v of values) collect(v, acc);
  const unique = Array.from(new Set(acc.map((s) => s.trim()).filter(Boolean)));
  unique.sort();
  return unique.slice(0, cap);
}

function collect(value: unknown, acc: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const v = value.trim();
    // A single whitespace-free token that is itself a grounded locator is kept
    // verbatim; anything with spaces is PROSE — extract the locator tokens from it
    // (a sentence containing a "/" must not be captured whole as one "locator").
    if (v && !/\s/.test(v) && isGroundedEvidence(v)) acc.push(v);
    else for (const tok of locatorsFromText(v)) acc.push(tok);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, acc);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collect(item, acc);
  }
}

// Pull file:line / file.ext / URL / `backtick` tokens out of a prose string, then
// keep only the grounded ones. Backtick spans are a strong signal for code refs.
const LOCATOR_RE = /`([^`]+)`|([A-Za-z0-9_@./-]+\.[A-Za-z]{1,8}(?::\d+(?:-\d+)?)?)|(https?:\/\/[^\s)]+)/g;

function locatorsFromText(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOCATOR_RE.lastIndex = 0;
  while ((m = LOCATOR_RE.exec(text))) {
    const tok = (m[1] || m[2] || m[3] || "").trim();
    if (tok && isGroundedEvidence(tok)) out.push(tok);
  }
  return out;
}

function stripFence(markdown: string): string {
  return markdown.replace(/```cw:result\s*[\s\S]*?```/g, "");
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function firstNonEmptyLine(markdown: string): string {
  return (
    markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("```")) || ""
  );
}

/** True when an accepted result captured no structured signal at all. Drives the
 *  "warn, don't silently pass" surface in the record paths. */
export function isEmptyCapture(envelope: ResultEnvelope): boolean {
  return (envelope.findings?.length || 0) === 0 && (envelope.evidence?.length || 0) === 0;
}

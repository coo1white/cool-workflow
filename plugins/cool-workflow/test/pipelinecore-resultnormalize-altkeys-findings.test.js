#!/usr/bin/env node
// pipelinecore-resultnormalize-altkeys-findings — normalizeResultEnvelope's
// alt-key finding-array fallback chain, per-finding field normalization
// (id/classification/severity/evidence), and the evidence cap/dedup/sort
// rules. SPEC/pipeline-run.md "Result ingest" section (now src/core/pipeline/result-normalize.ts).

const assert = require("node:assert/strict");
const { normalizeResultEnvelope } = require("../dist/core/pipeline/result-normalize");

function fence(obj) {
  return "```cw:result\n" + JSON.stringify(obj) + "\n```";
}

// Canonical "findings" wins even when other alt keys are also present.
{
  const md = fence({ findings: [{ id: "f1" }], risks: [{ id: "should-not-be-used" }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings.length, 1);
  assert.equal(env.findings[0].id, "f1");
}

// Empty canonical "findings" array falls through to the first non-empty
// alt key, in FINDING_ARRAY_KEYS order (candidate_risks before risks).
{
  const md = fence({ findings: [], candidate_risks: [{ id: "cr1" }], risks: [{ id: "r1" }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings.length, 1);
  assert.equal(env.findings[0].id, "cr1", "candidate_risks must win over risks per the fixed key order");
}

// Each alt key in the fallback chain works on its own.
for (const key of ["candidateRisks", "risks", "ranked_risks", "rankedRisks", "top_risks", "topRisks", "issues", "problems", "concerns"]) {
  const md = fence({ [key]: [{ id: `from-${key}` }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings.length, 1, `key ${key} must be recognized as a findings source`);
  assert.equal(env.findings[0].id, `from-${key}`);
}

// A non-object finding item (string) is coerced into a finding with
// classification "unknown" and an auto id.
{
  const md = fence({ findings: ["a plain string finding"] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].id, "finding-1");
  assert.equal(env.findings[0].classification, "unknown");
}

// Finding id fallback chain: id > key > name > title > "finding-<n>".
{
  const md = fence({ findings: [{ key: "from-key" }, { name: "from-name" }, { title: "from-title" }, {}] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].id, "from-key");
  assert.equal(env.findings[1].id, "from-name");
  assert.equal(env.findings[2].id, "from-title");
  assert.equal(env.findings[3].id, "finding-4", "index is 1-based and counts ALL findings, not just ones needing a fallback");
}

// Classification coercion: confirmed/true/valid -> real;
// possible/maybe/potential -> conditional; a value containing both "non"
// and "issue" -> non-issue; anything else unrecognized -> unknown.
{
  const md = fence({
    findings: [
      { id: "a", classification: "confirmed" },
      { id: "b", classification: "true" },
      { id: "c", classification: "valid" },
      { id: "d", classification: "possible" },
      { id: "e", classification: "maybe" },
      { id: "f", classification: "potential" },
      { id: "g", classification: "Non-Issue" },
      { id: "h", classification: "totally unrecognized" },
    ],
  });
  const env = normalizeResultEnvelope(md);
  const byId = Object.fromEntries(env.findings.map((f) => [f.id, f.classification]));
  assert.equal(byId.a, "real");
  assert.equal(byId.b, "real");
  assert.equal(byId.c, "real");
  assert.equal(byId.d, "conditional");
  assert.equal(byId.e, "conditional");
  assert.equal(byId.f, "conditional");
  assert.equal(byId.g, "non-issue", "case-insensitive non+issue substring match");
  assert.equal(byId.h, "unknown");
}

// A canonical classification value (already one of the four) passes
// through unchanged, case-insensitively.
{
  const md = fence({ findings: [{ id: "a", classification: "CONDITIONAL" }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].classification, "conditional");
}

// Missing classification key entirely -> "unknown" (the ?? "unknown"
// fallback in normalizeFinding, not normalizeClassification's own
// undefined branch which also returns undefined -> coalesced).
{
  const md = fence({ findings: [{ id: "a" }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].classification, "unknown");
}

// Severity tag extraction: an explicit P0-P3 token wins outright, even
// over a conflicting keyword elsewhere in the same string.
{
  const md = fence({ findings: [{ id: "a", severity: "P2 but feels like CRIT" }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].severity, "P2");
}

// Severity keyword fallback ladder: CRIT/BLOCKER->P0, HIGH/SEV->P1,
// MED->P2, LOW/MINOR/NIT->P3, else "none".
{
  const md = fence({
    findings: [
      { id: "a", severity: "CRITICAL" },
      { id: "b", severity: "blocker" },
      { id: "c", severity: "High" },
      { id: "d", severity: "severe" },
      { id: "e", severity: "medium" },
      { id: "f", severity: "low" },
      { id: "g", severity: "minor" },
      { id: "h", severity: "nit" },
      { id: "i", severity: "whatever" },
    ],
  });
  const env = normalizeResultEnvelope(md);
  const byId = Object.fromEntries(env.findings.map((f) => [f.id, f.severity]));
  assert.equal(byId.a, "P0");
  assert.equal(byId.b, "P0");
  assert.equal(byId.c, "P1");
  assert.equal(byId.d, "P1");
  assert.equal(byId.e, "P2");
  assert.equal(byId.f, "P3");
  assert.equal(byId.g, "P3");
  assert.equal(byId.h, "P3");
  assert.equal(byId.i, "none");
}

// Severity read from alt keys: priority/level/rank/rating (not just
// "severity").
{
  const md = fence({ findings: [{ id: "a", priority: "HIGH" }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].severity, "P1");
}

// Top-level canonical "evidence" array (non-empty) wins verbatim, NOT
// deduped/sorted/re-harvested.
{
  const md = fence({ findings: [], evidence: ["z.ts:9", "a.ts:1", "a.ts:1"] });
  const env = normalizeResultEnvelope(md);
  assert.deepEqual(env.evidence, ["z.ts:9", "a.ts:1", "a.ts:1"], "a canonical, non-empty evidence array must pass through untouched (no sort/dedup)");
}

// Top-level evidence EMPTY canonical array falls through to harvested,
// grounded, deduped, SORTED locators.
{
  const md = fence({ findings: [], evidence: [] });
  const withProse = "See `z.ts:9` and `a.ts:1` and `a.ts:1` again.\n" + fence({ findings: [], evidence: [] });
  const env = normalizeResultEnvelope(withProse);
  assert.deepEqual(env.evidence, ["a.ts:1", "z.ts:9"], "harvested evidence must be deduped and sorted lexically");
}

// Per-finding evidence: explicit per-finding evidence keys (evidence,
// evidence_paths, etc.) win over harvesting the whole finding object —
// a non-evidence-key field (summary) is NOT folded in when an explicit
// evidence key is present.
{
  const md = fence({ findings: [{ id: "a", evidence: ["explicit.ts:1"], summary: "prose mentioning nothing.ts:2" }] });
  const env = normalizeResultEnvelope(md);
  assert.deepEqual(env.findings[0].evidence, ["explicit.ts:1"]);
}

// Per-finding evidence cap is 32 (verified against an explicit per-finding
// evidence array, the canonical-array path there is likewise
// pass-through-verbatim — so cap enforcement only shows up when the
// per-finding array EXCEEDS the cap and canonicalEvidence-style shortcut
// does not apply, since normalizeFinding always routes explicit evidence
// through harvestGrounded, unlike the top-level canonical-evidence
// shortcut).
{
  const manyLocators = Array.from({ length: 50 }, (_, i) => `file${String(i).padStart(4, "0")}.ts:${i}`);
  const md = fence({ findings: [{ id: "a", evidence: manyLocators }] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.findings[0].evidence.length, 32, "per-finding evidence must cap at 32");
}

// Top-level evidence cap is 256 — only enforced on the HARVESTED path (an
// empty canonical "evidence" array falls through to harvesting grounded
// locators from the whole parsed JSON + findings + de-fenced prose).
{
  const manyLocators = Array.from({ length: 300 }, (_, i) => `file${String(i).padStart(4, "0")}.ts:${i}`);
  const md = fence({ notes: manyLocators, evidence: [] });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.evidence.length, 256, "top-level HARVESTED evidence must cap at 256");
}

// A non-empty canonical top-level "evidence" array is NOT capped — it
// passes through verbatim even past 256 entries (the cap only guards the
// harvest fallback, not the canonical-array fast path).
{
  const manyLocators = Array.from({ length: 300 }, (_, i) => `file${String(i).padStart(4, "0")}.ts:${i}`);
  const md = fence({ findings: [], evidence: manyLocators });
  const env = normalizeResultEnvelope(md);
  assert.equal(env.evidence.length, 300, "a non-empty canonical evidence array bypasses the 256 cap entirely");
}

process.stdout.write("pipelinecore-resultnormalize-altkeys-findings: ok\n");

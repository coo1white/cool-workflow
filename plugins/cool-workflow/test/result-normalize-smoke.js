#!/usr/bin/env node
// Robust ingest (v0.1.42): CW extracts findings/evidence from whatever reasonable
// shape an agent emits, and derives grounded evidence itself — without trusting
// the agent to use CW's exact keys. Canonical results pass through unchanged.
const assert = require("node:assert/strict");
const { parseResultEnvelope } = require("../dist/verifier");
const { isEmptyCapture } = require("../dist/result-normalize");

// 1) Canonical schema passes through UNCHANGED (backward compatibility).
const canon = "```cw:result\n" + JSON.stringify({
  summary: "s",
  findings: [{ id: "f1", classification: "real", severity: "P1", evidence: ["x.ts:1"] }],
  evidence: ["x.ts:1"]
}) + "\n```";
const c = parseResultEnvelope(canon);
assert.deepEqual(c.findings, [{ id: "f1", classification: "real", severity: "P1", evidence: ["x.ts:1"] }], "canonical findings unchanged");
assert.deepEqual(c.evidence, ["x.ts:1"], "canonical evidence unchanged");
console.log("result-normalize: canonical pass-through ok");

// 2) Agent's OWN shape (no findings/evidence keys) -> findings extracted, evidence derived.
const agent = "prose intro\n\n```cw:result\n" + JSON.stringify({
  task: "map:server-api",
  inspected_files: ["apps/api/src/app.ts"],
  invariants: ["Auth wall before public routes (app.ts:632).", "Session revalidated (auth.ts:189)."],
  candidate_risks: [
    { id: "R1", severity: "P1", detail: "revoke stays live on render failure", location: "app.ts:1644" },
    { id: "R2", severity: "high", detail: "3 data stacks on one sqlite", files: ["packages/db/src/store.ts:12"] }
  ]
}) + "\n```\n";
const a = parseResultEnvelope(agent);
assert.equal(a.findings.length, 2, "extracts 2 findings from candidate_risks");
assert.equal(a.findings[0].severity, "P1", "P1 preserved");
assert.equal(a.findings[1].severity, "P1", "high -> P1");
assert.ok(a.findings[0].evidence.includes("app.ts:1644"), "per-finding locator derived");
assert.ok(a.evidence.includes("app.ts:632") && a.evidence.includes("auth.ts:189"), "evidence derived from invariants prose");
assert.ok(a.evidence.includes("packages/db/src/store.ts:12"), "evidence derived from nested finding files");
assert.ok(!isEmptyCapture(a), "agent shape is NOT empty capture");
console.log("result-normalize: agent-shape extraction ok");

// 3) Fence-less prose with cites -> clean locator tokens (not whole sentences).
const prose = "The auth wall is in `apps/api/src/app.ts:632` and docker-proxy.ts:30 gates the socket.";
const p = parseResultEnvelope(prose);
assert.deepEqual(p.evidence, ["apps/api/src/app.ts:632", "docker-proxy.ts:30"], "prose -> clean locators");
console.log("result-normalize: prose locator extraction ok");

// 4) Truly empty result is flagged.
assert.ok(isEmptyCapture(parseResultEnvelope("nothing structured here")), "empty result flagged");
assert.ok(!isEmptyCapture(p), "prose-with-cites not flagged empty");
console.log("result-normalize: empty-capture detection ok");

// 5) Bare-string findings array (some agents emit strings).
const strs = "```cw:result\n" + JSON.stringify({ risks: ["P0 — secret in /tmp (core-boundary.ts:256)", "minor: no body cap"] }) + "\n```";
const s = parseResultEnvelope(strs);
assert.equal(s.findings.length, 2, "string findings extracted");
assert.equal(s.findings[0].severity, "P0", "severity parsed from string");
assert.ok(s.findings[0].evidence.includes("core-boundary.ts:256"), "locator parsed from string finding");
console.log("result-normalize: string-finding extraction ok");

console.log("result-normalize: ok");

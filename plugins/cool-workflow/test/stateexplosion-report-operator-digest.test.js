#!/usr/bin/env node
// stateexplosion-report-operator-digest — pins buildOperatorDigest's exact
// shape: hiddenSourceRecords derivation, expansionCommands de-dup, the
// always-empty-today failures/evidenceDigest (no milestone-9 records yet),
// and trustDigest's policyViolations/judgeRationale counts.
//
// Evidence: SPEC/state-core.md digest/report sections; report.ts's
// buildOperatorDigest (this milestone's truthfully-empty failure surfaces).

const assert = require("node:assert/strict");
const { buildOperatorDigest } = require("../dist/core/state/state-explosion/report");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");
const { summarizeBlackboardDigest } = require("../dist/core/state/state-explosion/digest");
const { computeStateSizeWithGraph, DEFAULT_STATE_EXPLOSION_THRESHOLDS } = require("../dist/core/state/state-explosion/size");

const NOW = "2024-06-01T00:00:00.000Z";

function buildDigestFixture() {
  const workers = Array.from({ length: 8 }, (_, i) => ({ id: `run-1:worker:w${i}`, kind: "worker", status: "completed", label: `w${i}` }));
  const graphView = { nodes: workers, edges: [] };
  const compact = buildCompactGraphFromView("run-1", graphView, "compact", { now: NOW });
  const blackboard = summarizeBlackboardDigest({
    id: "run-1",
    blackboard: {
      boards: [],
      topics: [],
      messages: [],
      contexts: [],
      artifacts: [],
      decisions: [
        { id: "d1", kind: "review", outcome: "rejected", reason: "bad", status: "final", subjectIds: [], updatedAt: NOW },
      ],
    },
  });
  const stateSize = computeStateSizeWithGraph({}, DEFAULT_STATE_EXPLOSION_THRESHOLDS, { nodes: workers, edges: [] });
  return { compact, blackboard, stateSize };
}

// hiddenSourceRecords is derived 1:1 from compact.syntheticNodes.
{
  const { compact, blackboard, stateSize } = buildDigestFixture();
  const digest = buildOperatorDigest({ id: "run-1" }, compact, blackboard, stateSize, NOW);
  assert.equal(digest.hiddenSourceRecords.length, compact.syntheticNodes.length, "hiddenSourceRecords has one entry per synthetic node");
  assert.equal(digest.hiddenSourceRecords[0].count, compact.syntheticNodes[0].collapsedNodeCount, "hiddenSourceRecords count mirrors the synthetic node's collapsedNodeCount");
  assert.equal(digest.hiddenSourceRecords[0].kind, "workers", "hiddenSourceRecords kind is parsed from the synthetic node's id after ':summary:'");
}

// Truthfully-empty surfaces at this milestone: failures, evidenceDigest, trustDigest.events.
{
  const { compact, blackboard, stateSize } = buildDigestFixture();
  const digest = buildOperatorDigest({ id: "run-1" }, compact, blackboard, stateSize, NOW);
  assert.deepEqual(digest.failures, [], "failures is truthfully empty — no multi-agent failure records exist at this milestone");
  assert.deepEqual(digest.evidenceDigest, { adopted: 0, missing: 0, rejected: 0, entries: [] }, "evidenceDigest is truthfully empty at this milestone");
  assert.equal(digest.trustDigest.events, 0, "trustDigest.events is truthfully 0 — no trust-audit records exist at this milestone");
}

// trustDigest.policyViolations/judgeRationales mirror the blackboard digest's own counts.
{
  const { compact, blackboard, stateSize } = buildDigestFixture();
  const digest = buildOperatorDigest({ id: "run-1" }, compact, blackboard, stateSize, NOW);
  assert.equal(digest.trustDigest.policyViolations, blackboard.policyViolations.length, "trustDigest.policyViolations mirrors blackboard.policyViolations.length");
  assert.equal(digest.trustDigest.policyViolations, 1, "sanity: our fixture has exactly one rejected decision");
  assert.deepEqual(
    digest.trustDigest.entries,
    [...blackboard.policyViolations.map((p) => p.id), ...blackboard.judgeRationale.map((j) => j.id)].sort(),
    "trustDigest.entries is the sorted union of policyViolation and judgeRationale ids"
  );
}

// expansionCommands includes the 4 fixed commands plus every synthetic node's own expansionCommand, de-duplicated.
{
  const { compact, blackboard, stateSize } = buildDigestFixture();
  const digest = buildOperatorDigest({ id: "run-1" }, compact, blackboard, stateSize, NOW);
  assert.ok(digest.expansionCommands.includes("node scripts/cw.js multi-agent graph run-1 --view full --json"), "expansionCommands includes the fixed 'view full' command");
  assert.ok(digest.expansionCommands.includes("node scripts/cw.js multi-agent failures run-1 --json"), "expansionCommands includes the fixed 'failures' command");
  assert.equal(new Set(digest.expansionCommands).size, digest.expansionCommands.length, "expansionCommands has no duplicate entries");
}

// generatedAt and id/scope/schemaVersion are exact literals.
{
  const { compact, blackboard, stateSize } = buildDigestFixture();
  const digest = buildOperatorDigest({ id: "run-1" }, compact, blackboard, stateSize, NOW);
  assert.equal(digest.generatedAt, NOW, "generatedAt echoes the passed clock value exactly");
  assert.equal(digest.id, "operator-digest", "id is always the literal 'operator-digest'");
  assert.equal(digest.scope, "run", "scope is always 'run'");
  assert.equal(digest.schemaVersion, 1, "schemaVersion is 1 (STATE_EXPLOSION_SCHEMA_VERSION)");
  assert.equal(digest.deterministic, true, "deterministic is always true");
  assert.equal(digest.status, "valid", "status is always 'valid' for a freshly-built digest");
}

// sourceFingerprint composes compact/blackboard fingerprints + stateSize.total, via fingerprintStrings.
{
  const { compact, blackboard, stateSize } = buildDigestFixture();
  const digest = buildOperatorDigest({ id: "run-1" }, compact, blackboard, stateSize, NOW);
  const { fingerprintStrings } = require("../dist/core/hash");
  const expected = fingerprintStrings([compact.sourceFingerprint, blackboard.sourceFingerprint, String(stateSize.total)]);
  assert.equal(digest.sourceFingerprint, expected, "operator digest sourceFingerprint composes compact+blackboard fingerprints and stateSize.total");
}

process.stdout.write("stateexplosion-report-operator-digest: ok\n");

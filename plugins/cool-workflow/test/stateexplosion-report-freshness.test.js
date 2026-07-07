#!/usr/bin/env node
// stateexplosion-report-freshness — pins buildStateExplosionReport's
// freshness computation: absent index -> "absent"; matching persisted
// fingerprint -> "valid"; mismatched fingerprint or a stale per-entry
// scope -> "stale"; nextAction switches to "summary refresh" whenever
// stale or absent.
//
// Evidence: SPEC/state-core.md "buildStateExplosionReport(run, {
// thresholds?, index? }) — ... freshness.status valid|stale|absent
// computed against the persisted index fingerprint (absent index ->
// absent; mismatch or any stale scope -> stale) and nextAction becoming
// 'node scripts/cw.js summary refresh <runId>' when stale or absent".

const assert = require("node:assert/strict");
const { buildStateExplosionReport } = require("../dist/core/state/state-explosion/report");

const NOW = "2024-06-01T00:00:00.000Z";

function minimalRun() {
  return {
    id: "run-1",
    loopStage: "interpret",
    paths: { state: "/run-1/state.json" },
    tasks: [],
    dispatches: [],
    commits: [],
    blackboard: { schemaVersion: 1, boards: [], topics: [], messages: [], contexts: [], artifacts: [], snapshots: [], decisions: [] },
  };
}

// No index passed at all: freshness is "absent"; nextAction is "summary refresh".
{
  const report = buildStateExplosionReport(minimalRun(), { now: NOW });
  assert.equal(report.freshness.status, "absent", "no persisted index -> freshness absent");
  assert.equal(report.nextAction, "node scripts/cw.js summary refresh run-1", "absent freshness redirects nextAction to summary refresh");
  assert.equal(report.freshness.persistedFingerprint, undefined, "no persisted index -> no persistedFingerprint");
  assert.equal(report.index, undefined, "no persisted index -> report.index is undefined");
}

// An index whose sourceFingerprint matches the freshly-computed one, and
// whose entries are all internally consistent: freshness is "valid".
{
  const runValue = minimalRun();
  const firstPass = buildStateExplosionReport(runValue, { now: NOW });
  const matchingIndex = {
    schemaVersion: 1,
    runId: "run-1",
    id: "multi-agent-summary-index",
    scope: "run",
    sourceRecordIds: [],
    sourceFingerprint: firstPass.freshness.currentFingerprint,
    includedCount: 0,
    omittedCount: 0,
    importantRefs: [],
    evidenceRefs: [],
    trustAuditEventRefs: [],
    generatedAt: NOW,
    status: "valid",
    deterministic: true,
    nextAction: "x",
    entries: [
      {
        scope: "blackboard",
        id: firstPass.blackboardDigest.id,
        path: "x",
        sourceFingerprint: firstPass.blackboardDigest.sourceFingerprint,
        includedCount: 0,
        omittedCount: 0,
        status: "valid",
      },
    ],
    views: ["compact"],
    paths: { summariesDir: "x", indexPath: "x", reportPath: "x" },
  };
  const report = buildStateExplosionReport(runValue, { now: NOW, index: matchingIndex });
  assert.equal(report.freshness.status, "valid", "matching persisted fingerprint AND matching entries -> valid");
  assert.deepEqual(report.freshness.staleScopes, [], "no stale scopes when every entry's fingerprint matches");
  assert.equal(report.nextAction, report.operatorDigest.nextAction, "valid freshness keeps the operator digest's own nextAction");
}

// An index with a mismatched top-level sourceFingerprint: freshness is "stale".
{
  const runValue = minimalRun();
  const staleIndex = {
    schemaVersion: 1,
    runId: "run-1",
    id: "multi-agent-summary-index",
    scope: "run",
    sourceRecordIds: [],
    sourceFingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    includedCount: 0,
    omittedCount: 0,
    importantRefs: [],
    evidenceRefs: [],
    trustAuditEventRefs: [],
    generatedAt: NOW,
    status: "valid",
    deterministic: true,
    nextAction: "x",
    entries: [],
    views: ["compact"],
    paths: { summariesDir: "x", indexPath: "x", reportPath: "x" },
  };
  const report = buildStateExplosionReport(runValue, { now: NOW, index: staleIndex });
  assert.equal(report.freshness.status, "stale", "a mismatched top-level sourceFingerprint marks freshness stale");
  assert.equal(report.nextAction, "node scripts/cw.js summary refresh run-1", "stale freshness redirects nextAction to summary refresh");
}

// A per-entry stale scope (entry fingerprint mismatch) also flips overall
// status to "stale", even if the top-level fingerprint matches.
{
  const runValue = minimalRun();
  const firstPass = buildStateExplosionReport(runValue, { now: NOW });
  const indexWithStaleEntry = {
    schemaVersion: 1,
    runId: "run-1",
    id: "multi-agent-summary-index",
    scope: "run",
    sourceRecordIds: [],
    sourceFingerprint: firstPass.freshness.currentFingerprint,
    includedCount: 0,
    omittedCount: 0,
    importantRefs: [],
    evidenceRefs: [],
    trustAuditEventRefs: [],
    generatedAt: NOW,
    status: "valid",
    deterministic: true,
    nextAction: "x",
    entries: [
      {
        scope: "blackboard",
        id: firstPass.blackboardDigest.id,
        path: "x",
        sourceFingerprint: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        includedCount: 0,
        omittedCount: 0,
        status: "valid",
      },
    ],
    views: ["compact"],
    paths: { summariesDir: "x", indexPath: "x", reportPath: "x" },
  };
  const report = buildStateExplosionReport(runValue, { now: NOW, index: indexWithStaleEntry });
  assert.equal(report.freshness.status, "stale", "a stale per-entry scope flips overall freshness to stale even if the top-level fingerprint matches");
  assert.deepEqual(report.freshness.staleScopes, [`blackboard:${firstPass.blackboardDigest.id}`], "staleScopes names the exact 'scope:id' pair that mismatched");
}

// generatedAt/schemaVersion/runId are exact literals; stateSize/compactGraph/criticalPathGraph/blackboardDigest are all present.
{
  const report = buildStateExplosionReport(minimalRun(), { now: NOW });
  assert.equal(report.generatedAt, NOW, "generatedAt echoes the passed clock exactly");
  assert.equal(report.schemaVersion, 1, "schemaVersion is 1");
  assert.equal(report.runId, "run-1", "runId is passed through");
  assert.ok(report.stateSize, "stateSize is present");
  assert.ok(report.compactGraph, "compactGraph is present");
  assert.ok(report.criticalPathGraph, "criticalPathGraph is present");
  assert.equal(report.criticalPathGraph.view, "critical-path", "criticalPathGraph is built with view='critical-path'");
  assert.equal(report.compactGraph.view, "compact", "compactGraph is built with view='compact'");
  assert.ok(report.blackboardDigest, "blackboardDigest is present");
  assert.deepEqual(report.hiddenSourceRecords, report.operatorDigest.hiddenSourceRecords, "top-level hiddenSourceRecords mirrors operatorDigest's");
  assert.deepEqual(report.expansionCommands, report.operatorDigest.expansionCommands, "top-level expansionCommands mirrors operatorDigest's");
}

process.stdout.write("stateexplosion-report-freshness: ok\n");

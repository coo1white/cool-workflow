#!/usr/bin/env node
// formatapps-stateexplosion-blackboard-digest-text — pins
// formatBlackboardDigest's 12-section digest text (all "none"-guarded,
// unlike formatCompactGraph's Nodes section) and stateExplosionReportLines'
// markdown-fragment shape for report.md's State Size section.
//
// Evidence: SPEC/state-core.md "Human formatters (CLI text only, never
// --json)"; src/core/format/state-explosion-text.ts's formatBlackboardDigest
// / stateExplosionReportLines.

const assert = require("node:assert/strict");
const { formatBlackboardDigest, stateExplosionReportLines } = require("../dist/core/format/state-explosion-text");
const { summarizeBlackboardDigest } = require("../dist/core/state/state-explosion/digest");
const { buildStateExplosionReport } = require("../dist/core/state/state-explosion/report");

function minimalRun(overrides = {}) {
  return {
    id: "run-1",
    loopStage: "interpret",
    paths: { state: "/run-1/state.json" },
    tasks: [],
    dispatches: [],
    commits: [],
    ...overrides,
  };
}

// Empty blackboard: header names the runId (no blackboardId suffix when
// absent), the freshness/counts line, and every one of the 12 sections
// falls back to "none" — unlike formatCompactGraph, EVERY section here is
// guarded.
{
  const record = summarizeBlackboardDigest({ id: "run-1", blackboard: {} });
  const text = formatBlackboardDigest(record);
  const lines = text.split("\n");

  assert.equal(lines[0], "Blackboard Digest: run-1", "no blackboardId suffix when blackboardId is absent");
  assert.equal(lines[1], `  freshness=${record.status}; included=${record.includedCount}; omitted=${record.omittedCount}`, "counts line echoes record fields");

  const sections = [
    "Topic Rollups",
    "Thread Summaries",
    "Unresolved Questions",
    "Conflicts",
    "Decisions",
    "Artifacts",
    "Adopted Evidence",
    "Missing Evidence",
    "Policy Violations",
    "Judge Rationale",
    "Recent Changes",
    "High-Signal Records",
  ];
  for (const title of sections) {
    const idx = lines.indexOf(title);
    assert.ok(idx >= 0, `section "${title}" must be present`);
    assert.equal(lines[idx + 1], "  none", `section "${title}" must fall back to '  none' when its entry list is empty (ALL sections guarded here)`);
  }

  const nextActionIndex = lines.indexOf("Next Action");
  assert.equal(lines[nextActionIndex + 1], `  ${record.nextAction}`, "Next Action echoes record.nextAction verbatim");
}

// blackboardId present: header appends "(<blackboardId>)".
{
  const record = summarizeBlackboardDigest({ id: "run-1", blackboard: {} }, "board-9");
  const text = formatBlackboardDigest(record);
  // With no matching board in an empty blackboard, blackboardId stays
  // undefined on the record (board lookup finds nothing) — confirm the
  // header logic keys off record.blackboardId, not the requested id.
  assert.equal(record.blackboardId, undefined, "sanity: an unmatched blackboardId request leaves record.blackboardId undefined");
  assert.equal(text.split("\n")[0], "Blackboard Digest: run-1", "header omits the suffix when record.blackboardId ends up undefined");
}

// Entry rows render "[status] label; expand: <cmd>"; more than 25 entries
// truncates with a "... N more" trailer (every section shares this cap).
{
  const board = { id: "b1" };
  const topics = [];
  for (let i = 0; i < 27; i += 1) {
    topics.push({ id: `t${i}`, blackboardId: "b1", title: `Topic ${i}`, status: "open", contextIds: [], artifactRefIds: [] });
  }
  const record = summarizeBlackboardDigest({ id: "run-1", blackboard: { boards: [board], topics, messages: [], contexts: [], artifacts: [], decisions: [] } }, "b1");
  const text = formatBlackboardDigest(record);
  const lines = text.split("\n");
  const topicIndex = lines.indexOf("Topic Rollups");
  const allTopicLines = [];
  for (let i = topicIndex + 1; lines[i] !== "" && i < lines.length; i += 1) allTopicLines.push(lines[i]);
  const shownRows = allTopicLines.filter((l) => l.startsWith("  [open]"));
  const trailer = allTopicLines.find((l) => l.startsWith("  ... "));
  assert.equal(shownRows.length, 25, "at most 25 entries render per section");
  assert.equal(trailer, "  ... 2 more", "a truncation trailer names the exact remainder (27 - 25 = 2)");
}

// stateExplosionReportLines: markdown fragment lines for report.md's State
// Size section — always ends with a "- Next: `<nextAction>`" line, and
// includes a compaction status line using the same recommended/not-needed
// wording as the CLI text formatter.
{
  const report = buildStateExplosionReport(minimalRun(), { now: "2024-01-01T00:00:00.000Z" });
  const mdLines = stateExplosionReportLines(report);
  assert.ok(Array.isArray(mdLines), "stateExplosionReportLines returns an array of strings");
  assert.ok(mdLines[0].startsWith("- Records: "), "first line is the Records summary line");
  assert.equal(mdLines[1], "- Compaction: not needed", "an empty run's compaction line reads 'not needed'");
  assert.equal(mdLines[2], `- Summary freshness: ${report.freshness.status}`, "third line echoes freshness.status");
  const last = mdLines[mdLines.length - 1];
  assert.equal(last, `- Next: \`${report.nextAction}\``, "the last line is always '- Next: `<nextAction>`' in backticks");
}

// stateExplosionReportLines omits the "Graph compacted" line entirely when
// nothing collapsed (collapsedNodeCount === 0) — no empty/zero line noise.
{
  const report = buildStateExplosionReport(minimalRun(), { now: "2024-01-01T00:00:00.000Z" });
  assert.equal(report.compactGraph.collapsedNodeCount, 0, "sanity: an empty run has nothing collapsed");
  const mdLines = stateExplosionReportLines(report);
  assert.ok(!mdLines.some((l) => l.includes("Graph compacted")), "no 'Graph compacted' line renders when collapsedNodeCount is 0");
}

process.stdout.write("formatapps-stateexplosion-blackboard-digest-text: ok\n");

#!/usr/bin/env node
// report-cli-bundle-human — `cw report bundle` on a terminal says where the
// file went and how to put it somewhere else.
//
// The fault this guards (first-run walkthrough, 2026-11-03): the bundle
// lands in the cwd (often the repo root, a new untracked file) and the only
// output was JSON, so a new user did not see where it went or that
// --output exists. The TTY text now says both; a pipe keeps the JSON.

import assert from "node:assert/strict";
import path from "node:path";

import { formatReportBundle, formatReportVerifyBundle } from "../../../dist/shell/commands/report-cli.js";
import { shouldRenderHuman } from "../../../dist/cli/dispatch.js";
import { REGISTRY } from "../../../dist/wiring/capability-table/index.js";

const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

function result(ok, archivePath) {
  const verification = {
    schemaVersion: 1, archivePath, runId: "r-1", ok, archiveOk: ok, telemetryVerified: true, trustAuditVerified: true,
    trustKeySource: "none", signatureKeyProvided: false, signaturesChecked: 0, signaturesReverified: 0, signaturesFailed: 0,
    trustLevel: "unsigned", reportFindingsVerified: true, failedChecks: ok ? [] : [{ name: "archive", code: "digest-mismatch" }],
  };
  return { schemaVersion: 1, runId: "r-1", archivePath, trustKeyEmbedded: false, verification, ok };
}

// 1. A bundle under the cwd: a short path, the --output way, and one next step.
{
  const r = result(true, path.join(process.cwd(), "r-1.cwrun.json"));
  const text = strip(formatReportBundle(r));
  assert.ok(text.startsWith(strip(formatReportVerifyBundle(r.verification))), "the verify-bundle check comes first");
  assert.ok(text.endsWith(
    "\n\nBundle saved to: r-1.cwrun.json\n" +
    "  To save it somewhere else: cw report bundle r-1 --output <file>\n" +
    "  Next: send the file; anyone can check it with: cw report verify-bundle r-1.cwrun.json"
  ), text);
  console.log("report-cli-bundle-human: says where the file went and how to move it OK");
}

// 2. Outside the cwd: the whole path. A bundle that fails: do not send it.
{
  const elsewhere = path.resolve(process.cwd(), "..", "out", "r-1.cwrun.json");
  const text = strip(formatReportBundle(result(false, elsewhere)));
  assert.ok(text.includes(`\nBundle saved to: ${elsewhere}\n`));
  assert.ok(text.endsWith("\n  Do not send it: it did not pass the checks above."), text);
  console.log("report-cli-bundle-human: a failed bundle says not to send it OK");
}

// 3. The row renders this on a TTY only; a pipe keeps the JSON bytes.
{
  const row = REGISTRY.find((entry) => entry.capability === "report.bundle");
  assert.equal(row.cli.jsonMode, "default");
  assert.equal(typeof row.cli.humanRender, "function", "report bundle declares a humanRender");
  const r = result(true, path.join(process.cwd(), "r-1.cwrun.json"));
  assert.equal(row.cli.humanRender(r), formatReportBundle(r));
  assert.equal(shouldRenderHuman(row.cli.jsonMode, {}, true, { isTTY: false }), false, "a pipe stays JSON");
  assert.equal(shouldRenderHuman(row.cli.jsonMode, { json: true }, true, { isTTY: true }), false, "--json stays JSON");
  console.log("report-cli-bundle-human: TTY only, pipes keep the JSON OK");
}

console.log("report-cli-bundle-human.test: ok");

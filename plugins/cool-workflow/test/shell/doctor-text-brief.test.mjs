#!/usr/bin/env node
// doctor-text-brief.test — the text view of `cw doctor` (intent
// 2026-11-11-user-facing-fixes.md, rows 10 and 11):
//   - the sandbox-enforceability line is one short line; the long detail
//     stays in the report object, which is what --json prints;
//   - the three quick start rows put their dash at one column.

import assert from "node:assert/strict";
import { formatDoctorReport } from "../../dist/shell/doctor.js";

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const LONG = "CW sandbox profiles validate policy and gate worker-output acceptance; long text";
const report = {
  schemaVersion: 1,
  ok: true,
  summary: "ready — all checks passed",
  checks: [
    { name: "node", status: "ok", detail: "Node v22." },
    { name: "sandbox-enforceability", status: "ok", detail: LONG },
  ],
};

{
  const lines = plain(formatDoctorReport(report)).split("\n");
  const line = lines.find((l) => l.includes("sandbox-enforceability"));
  assert.equal(
    line,
    "  ✓ sandbox-enforceability: policy is checked by CW; OS isolation is the host's job (docs/sandbox-profiles.7.md).",
    "the text view has the short sandbox line"
  );
  assert.ok(lines.includes("  ✓ node: Node v22."), "every other check keeps its own detail");
  assert.equal(report.checks[1].detail, LONG, "the report object (the --json bytes) keeps the long detail");
  console.log("doctor-text-brief: short sandbox line, long detail kept for --json ok");
}

{
  const onramp = { summary: "s", sections: [] };
  const lines = plain(formatDoctorReport({ ...report, onramp })).split("\n");
  const steps = lines.filter((l) => /^ {2}[123]\. cw /.test(l));
  assert.equal(steps.length, 3, "three quick start rows");
  const columns = steps.map((l) => l.indexOf(" — "));
  assert.ok(columns[0] > 0 && columns.every((c) => c === columns[0]), `the three dashes are at one column: ${columns.join(", ")}`);
  console.log("doctor-text-brief: quick start dashes in one column ok");
}

console.log("doctor-text-brief.test: ok");

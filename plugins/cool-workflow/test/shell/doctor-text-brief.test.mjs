#!/usr/bin/env node
// doctor-text-brief.test — the text view of `cw doctor`: every check keeps
// its own detail, and the three quick start rows put their dash at one column.

import assert from "node:assert/strict";
import { formatDoctorReport } from "../../dist/shell/doctor.js";

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const report = {
  schemaVersion: 1,
  ok: true,
  summary: "ready — all checks passed",
  checks: [{ name: "node", status: "ok", detail: "Node v22." }],
};

{
  const lines = plain(formatDoctorReport(report)).split("\n");
  assert.ok(lines.includes("  ✓ node: Node v22."), "a check keeps its own detail");
  const steps = lines.filter((l) => /^ {2}[123]\. cw /.test(l));
  assert.equal(steps.length, 3, "three quick start rows");
  const columns = steps.map((l) => l.indexOf(" — "));
  assert.ok(columns[0] > 0 && columns.every((c) => c === columns[0]), `the three dashes are at one column: ${columns.join(", ")}`);
}

console.log("doctor-text-brief.test: ok");

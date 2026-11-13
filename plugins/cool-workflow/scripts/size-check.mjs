#!/usr/bin/env node
// size-check — fail closed when src/**/*.ts grows past 5,000 physical lines.
//
// Why: src/ grew to 31,802 lines around a core path (ask, report, check,
// verify) that fits in a third of that; batch 5 cut it back, and the
// 2026-11-13 cut (doctor, fix, demo tamper, comments) took it under 5,000.
// A ceiling keeps the next feature from growing it back unseen. The count is the same as
// `find src -name '*.ts' | xargs cat | wc -l`: newline characters.
//
//   node scripts/size-check.mjs            # check plugins/cool-workflow/src
//   node scripts/size-check.mjs <dir>      # check another tree (the smoke uses this)
//   CW_SIZE_CHECK_SRC=<dir> node scripts/size-check.mjs
//
// Prints the total and the 10 biggest files; exits 1 above the limit.

import fs from "node:fs";
import path from "node:path";

export const MAX_SRC_LINES = 5000;

function tsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function lineCount(file) {
  const bytes = fs.readFileSync(file);
  let n = 0;
  for (const byte of bytes) if (byte === 10) n += 1;
  return n;
}

const srcDir = path.resolve(process.argv[2] || process.env.CW_SIZE_CHECK_SRC || path.join(import.meta.dirname, "..", "src"));
const rows = tsFiles(srcDir)
  .map((file) => ({ file: path.relative(srcDir, file).split(path.sep).join("/"), lines: lineCount(file) }))
  .sort((a, b) => b.lines - a.lines || (a.file < b.file ? -1 : 1));
const total = rows.reduce((sum, row) => sum + row.lines, 0);
const ok = total <= MAX_SRC_LINES;

process.stdout.write(`size-check: src/ has ${total} lines (limit ${MAX_SRC_LINES}) — ${ok ? "ok" : "OVER"}\n`);
for (const row of rows.slice(0, 10)) process.stdout.write(`  ${String(row.lines).padStart(6)}  ${row.file}\n`);
if (!ok) {
  process.stderr.write(`size-check: src/ is ${total - MAX_SRC_LINES} lines over the limit; cut code before adding more\n`);
  process.exitCode = 1;
}

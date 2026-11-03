// test/helpers/stub-agent.mjs — a stub agent script for drive tests
// (refactor phase 3, project/docs/intent/2026-11-03-refactor-whole-tree.md).
//
// Consumers: test/helpers/helpers.test.mjs, test/drive-round-cache-serial-smoke.mjs.
//
// writeStubAgent(file, opts) writes a CommonJS script that takes the result
// path as argv[2], writes a valid cw:result envelope there (evidence names
// <cwd>/README.md:1, see tmpWorkspace), and prints { model, usage } on
// stdout. With no opts the bytes are those of the most common local
// writeStub(file). opts:
//   summary   (default "s")      the envelope summary
//   model     (default "stub")   the model it reports
//   usage     (default 1 in, 1 out) the token usage it reports
//   countFile (default none)     a file it adds one "x" to per spawn
// Gives back file.

import fs from "node:fs";

export function writeStubAgent(file, opts = {}) {
  const { summary = "s", model = "stub", usage = { input_tokens: 1, output_tokens: 1 }, countFile } = opts;
  const fence = String.fromCharCode(96).repeat(3);
  const lines = [
    'const fs = require("fs");',
    "const rp = process.argv[2];",
    ...(countFile ? [`fs.appendFileSync(${JSON.stringify(countFile)}, "x");`] : []),
    `const body = "# R\\n\\n" + ${JSON.stringify(fence)} + "cw:result\\n" + JSON.stringify({ summary: ${JSON.stringify(summary)}, findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + ${JSON.stringify(fence)} + "\\n";`,
    "fs.writeFileSync(rp, body);",
    `process.stdout.write(JSON.stringify({ model: ${JSON.stringify(model)}, usage: { input_tokens: ${usage.input_tokens}, output_tokens: ${usage.output_tokens} } }));`,
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

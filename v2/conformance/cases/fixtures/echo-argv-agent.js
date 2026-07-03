#!/usr/bin/env node
"use strict";

// echo-argv-agent — a deterministic fake agent that writes its FULL argv
// list to a file, then completes the worker like stub-agent does. Used to
// prove CW_AGENT_COMMAND token substitution ({{manifest}} {{input}}
// {{result}} {{workerDir}} {{model}} {{prompt}}) lands real, existing
// paths as DISCRETE argv elements — never through a shell.
//
// Wire it up with an argv template that lists every token you want to
// check, e.g.:
//   CW_AGENT_COMMAND = "node <this file> {{manifest}} {{input}} {{result}}
//     {{workerDir}} {{model}} {{prompt}} {{unknown}}"
// and env CW_ECHO_ARGV_OUT = a file path this script writes its argv JSON
// array to (so the case can read it back after the run).

const fs = require("node:fs");

const outPath = process.env.CW_ECHO_ARGV_OUT;
if (!outPath) {
  process.stderr.write("echo-argv-agent: CW_ECHO_ARGV_OUT not set\n");
  process.exit(1);
}
fs.writeFileSync(outPath, JSON.stringify(process.argv.slice(2), null, 2));

// The result path is a positional slot in the caller's own template; find
// it by matching the one argv element that looks like a result.md path
// under a workers/ dir, so this fixture works with any token ORDER.
const resultPath = process.argv.slice(2).find((a) => /result\.md$/.test(a));
if (!resultPath) {
  process.stderr.write("echo-argv-agent: no ...result.md argv element found\n");
  process.exit(1);
}

const evidence = process.env.CW_STUB_EVIDENCE || "a.txt:1";
const body = `Stub finding for a conformance case.

\`\`\`cw:result
${JSON.stringify(
  { summary: "echo-argv-agent: deterministic canned result", findings: [], evidence: [evidence] },
  null,
  2
)}
\`\`\`
`;
fs.writeFileSync(resultPath, body, "utf8");
process.stdout.write(JSON.stringify({ model: "echo-argv-agent-1" }) + "\n");

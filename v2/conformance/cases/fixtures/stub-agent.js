#!/usr/bin/env node
"use strict";

// stub-agent — a deterministic fake agent for conformance cases.
//
// Wire it up with: CW_AGENT_COMMAND="node <this file> {{input}} {{result}}"
// CW substitutes {{input}} to the worker's input file path and {{result}} to
// the path this script must write its result.md to. This mirrors exactly what
// a real agent CLI (claude -p, codex exec, ...) is expected to do: read the
// task, then write a Markdown result ending in a ```cw:result fenced JSON
// block (summary, findings[], evidence[]) — the ONLY shape CW's accept layer
// (recordWorkerOutput / normalizeResultEnvelope) requires.
//
// Deterministic: content depends only on the input file content (so re-runs
// are byte-stable), never on time or randomness — conformance cases may rely
// on stable output across runs.

const fs = require("node:fs");

const inputPath = process.argv[2];
const resultPath = process.argv[3];

if (!resultPath) {
  process.stderr.write("stub-agent: no {{result}} path given\n");
  process.exit(1);
}

// Evidence must resolve on disk relative to the run's repo (CW_REQUIRE_RESOLVABLE_EVIDENCE
// defaults on). A case sets CW_STUB_EVIDENCE to a real path:line in its own fixture repo;
// the default matches lib.gitRepo()'s default seed file.
const evidence = process.env.CW_STUB_EVIDENCE || "a.txt:1";
void inputPath;

const body = `Stub finding for a conformance case.

\`\`\`cw:result
${JSON.stringify(
  {
    summary: "stub-agent: deterministic canned result",
    findings: [
      {
        id: "stub-finding-1",
        title: "stub finding",
        severity: "P2",
        classification: "non-issue",
        evidence: [evidence],
      },
    ],
    evidence: [evidence],
  },
  null,
  2
)}
\`\`\`
`;

fs.writeFileSync(resultPath, body, "utf8");
process.stdout.write(JSON.stringify({ model: "stub-agent-1" }) + "\n");

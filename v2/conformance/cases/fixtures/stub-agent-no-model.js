#!/usr/bin/env node
"use strict";

// stub-agent-no-model — a deterministic fake agent that writes a real
// result.md (so the worker hop succeeds normally) but deliberately reports
// NO model on stdout. Used to pin model-attestation honesty: the recorded
// reportedModel must be the exact string "unreported" — never backfilled
// from CW_AGENT_MODEL or any other config value, even though the operator
// may have set a policy model.
//
// Wire it up with: CW_AGENT_COMMAND="node <this file> {{input}} {{result}}"

const fs = require("node:fs");

const resultPath = process.argv[3];
if (!resultPath) {
  process.stderr.write("stub-agent-no-model: no {{result}} path given\n");
  process.exit(1);
}

const evidence = process.env.CW_STUB_EVIDENCE || "a.txt:1";

const body = `Stub finding for a conformance case (no model reported).

\`\`\`cw:result
${JSON.stringify(
  {
    summary: "stub-agent-no-model: deterministic canned result, no model field",
    findings: [
      {
        id: "stub-no-model-finding-1",
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
// Deliberately no "model" key anywhere in the stdout report — this is the
// point of the fixture. Usage is present (so a UsageRecord CAN be created)
// but carries no model hint of its own.
process.stdout.write(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }) + "\n");

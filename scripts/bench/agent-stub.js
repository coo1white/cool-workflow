#!/usr/bin/env node
"use strict";
// bench/agent-stub.js — configurable stub agent for benchmark runs.
// Simulates different LLM agents with adjustable latency.
//
// Usage: node agent-stub.js [--agent <name>] [--delay-ms <N>] <resultPath>
//   --agent:      one of claude|gemini|deepseek|codex (default: claude)
//   --delay-ms:   milliseconds to sleep before writing result (overrides agent default)
//   <resultPath>: path to write result.md (passed by CW as {{result}})
//
// Agent defaults (approximate API latencies):
//   claude    45s
//   gemini    30s
//   deepseek  20s
//   codex     25s

const fs = require("fs");

const DEFAULT_DELAYS = {
  claude:   45000,
  gemini:   30000,
  deepseek: 20000,
  codex:    25000,
};

function parseArgs(argv) {
  const opts = { agent: "claude", delayMs: 0, resultPath: "" };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--agent" && argv[i + 1]) {
      opts.agent = argv[++i];
    } else if (argv[i] === "--delay-ms" && argv[i + 1]) {
      opts.delayMs = parseInt(argv[++i], 10) || 0;
    } else {
      positional.push(argv[i]);
    }
  }
  opts.resultPath = positional[positional.length - 1] || "";
  if (!opts.delayMs) opts.delayMs = DEFAULT_DELAYS[opts.agent] || DEFAULT_DELAYS.claude;
  return opts;
}

const opts = parseArgs(process.argv);
if (!opts.resultPath) {
  process.stderr.write("agent-stub: missing result path\n");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  await sleep(opts.delayMs);

  const fence = "```";
  const body = [
    "# Benchmark Result",
    "",
    `${fence}cw:result`,
    JSON.stringify({
      summary: `Stub ${opts.agent} benchmark result (delay=${opts.delayMs}ms)`,
      findings: [],
      evidence: ["README.md:1"]
    }),
    fence,
    "",
  ].join("\n");

  fs.writeFileSync(opts.resultPath, body, "utf8");
  process.stdout.write(JSON.stringify({ model: `stub-${opts.agent}`, usage: { input_tokens: 4, output_tokens: 2 } }));
}

run().catch((e) => {
  process.stderr.write(`agent-stub: ${e.message}\n`);
  process.exit(1);
});

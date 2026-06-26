#!/usr/bin/env node
"use strict";

// gemini-opencode-agent.js - Gemini (via opencode) adapter for CW Agent Delegation.
//
// Reaches Gemini through `opencode run --model google/...`, the same gateway CW
// uses for DeepSeek. Use this when the Gemini key lives in opencode (provider
// "google") rather than the standalone `gemini` CLI. The native Gemini CLI path
// is still available as builtin:gemini-cli (scripts/agents/gemini-agent.js).
//
// Thin variant of the opencode runner: it sets the variant env (display label +
// model) and delegates to opencode-agent.js, so run/parse/provenance live in ONE
// place. Override the model with CW_GEMINI_MODEL (default google/gemini-3.5-flash).
// Requires opencode installed AND a "google" provider authed in opencode
// (`opencode auth login` -> google). Without it, opencode exits nonzero and CW
// fails closed - it never fabricates a result.
//
// Contract (unchanged from opencode-agent.js):
//   argv[2] = {{input}}   worker input.md
//   argv[3] = {{result}}  worker result.md to persist

process.env.CW_OPENCODE_LABEL = "gemini";
process.env.CW_OPENCODE_MODEL = process.env.CW_GEMINI_MODEL || "google/gemini-3.5-flash";

require("./opencode-agent.js");

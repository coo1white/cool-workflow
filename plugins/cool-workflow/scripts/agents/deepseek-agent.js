#!/usr/bin/env node
"use strict";

// deepseek-agent.js - DeepSeek (via opencode) adapter for CW Agent Delegation Drive.
//
// DeepSeek ships no standalone CLI here; CW reaches it through
// `opencode run --model deepseek/...`. This is a thin variant of the opencode
// runner: it sets the variant env (display label + model) and delegates to
// opencode-agent.js, so the run/parse/provenance logic lives in ONE place.
//
// Override the model with CW_DEEPSEEK_MODEL (default deepseek/deepseek-chat).
// Requires opencode installed AND a DeepSeek provider configured in opencode
// (`opencode auth login` or DEEPSEEK_API_KEY). Without that, opencode exits
// nonzero and CW fails closed - it never fabricates a result.
//
// Contract (unchanged from opencode-agent.js):
//   argv[2] = {{input}}   worker input.md
//   argv[3] = {{result}}  worker result.md to persist

process.env.CW_OPENCODE_LABEL = "deepseek";
process.env.CW_OPENCODE_MODEL = process.env.CW_DEEPSEEK_MODEL || "deepseek/deepseek-chat";

require("./opencode-agent.js");

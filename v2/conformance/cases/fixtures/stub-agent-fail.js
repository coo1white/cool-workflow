#!/usr/bin/env node
"use strict";

// stub-agent-fail — a deterministic fake agent that ALWAYS fails.
//
// Wire it up with: CW_AGENT_COMMAND="node <this file> {{input}} {{result}}"
// It never writes a result.md and always exits 1, so a drive step that
// dispatches to it takes the "agent hop failed" branch every time. Used
// to force retry accounting and the park (failed-past-retry-budget) state
// black-box, without a real agent CLI.

process.stderr.write("stub-agent-fail: deterministic failure for a conformance case\n");
process.exit(1);

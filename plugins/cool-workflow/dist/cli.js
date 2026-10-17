#!/usr/bin/env node
"use strict";
// src/cli.ts — the real CLI binary entry point. Compiles to dist/cli.js,
// which scripts/cw.js requires and which conformance/run.js drives
// directly with `node dist/cli.js <args>`. Import, call, catch — nothing
// else lives here.
Object.defineProperty(exports, "__esModule", { value: true });
const entry_1 = require("./cli/entry");
(0, entry_1.main)(process.argv.slice(2));

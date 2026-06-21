#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_surface_1 = require("./cli/command-surface");
const term_1 = require("./term");
(0, command_surface_1.runCli)(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    // Errors go to stderr → color must key off stderr (not the term default).
    process.stderr.write(`${(0, term_1.bold)("cw:", process.stderr)} ${(0, term_1.red)(message, process.stderr)}\n`);
    process.exitCode = 1;
});

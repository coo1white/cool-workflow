#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const command_surface_1 = require("./cli/command-surface");
(0, command_surface_1.runCli)(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cw: ${message}\n`);
    process.exitCode = 1;
});

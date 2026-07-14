#!/usr/bin/env node
"use strict";
// src/mcp-server.ts — the real MCP server binary entry point. Compiles to
// dist/mcp-server.js, a sibling of dist/cli.js. Byte-exact shape of the
// old build's src/mcp-server.ts (scripts/mcp-server.js requires it; a
// real MCP client launches it directly with `node`).
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./mcp/server");
/** Broken-pipe guard for the MCP stdio server, the same idea as
 *  cli/entry.ts's `main()`. When an MCP client closes the read end of our
 *  stdout part-way through a reply, the raw write gives an async 'error'
 *  event that no promise `.catch` can see; with no listener Node comes down
 *  hard with a `write EPIPE` stack and exit 1. One process-level listener
 *  turns that into a quiet exit 0 — the reader has gone, there is nothing
 *  left to say. Any other stream error is thrown again, same as before.
 *
 *  This is a small COPY of cli/entry.ts's helper, not an import: the purity
 *  gate (scripts/purity-gate.js) forbids an mcp/ file from importing cli/,
 *  and pulling in the whole CLI entry graph for five lines would be worse. */
function exitQuietOnEpipe(stream) {
    stream.on("error", (error) => {
        if (error && error.code === "EPIPE")
            process.exit(0);
        throw error;
    });
}
exitQuietOnEpipe(process.stdout);
exitQuietOnEpipe(process.stderr);
try {
    (0, server_1.startServer)();
}
catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cool-workflow mcp: ${text}\n`);
    process.exitCode = 1;
}

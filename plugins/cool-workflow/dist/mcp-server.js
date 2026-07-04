#!/usr/bin/env node
"use strict";
// src/mcp-server.ts — the real MCP server binary entry point. Compiles to
// dist/mcp-server.js, a sibling of dist/cli.js. Byte-exact shape of the
// old build's src/mcp-server.ts (scripts/mcp-server.js requires it; a
// real MCP client launches it directly with `node`).
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./mcp/server");
(0, server_1.startServer)();

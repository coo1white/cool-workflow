#!/usr/bin/env node
// src/cli.ts — the real CLI binary entry point. Compiles to dist/cli.js,
// which scripts/cw.js requires and which conformance/run.js drives
// directly with `node dist/cli.js <args>`. Byte-exact shape of src/cli.ts
// in the old build (import, call, catch — nothing else lives here).

import { main } from "./cli/entry";

main(process.argv.slice(2));

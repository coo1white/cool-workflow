#!/usr/bin/env node
// @cw-smoke: tags fast

// A stopped tool child fails the one in-flight call without replaying it. The
// next call starts a fresh child and can complete.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
import { ToolProcessExecutor } from "../dist/mcp/tool-process.js";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-tool-process-"));
const worker = path.join(tmp, "worker.js");
fs.writeFileSync(
  worker,
  [
    '"use strict";',
    "process.on('message', (message) => {",
    "  if (message.name === 'stop') process.exit(17);",
    "  process.send({ schemaVersion: 1, id: message.id, ok: true, text: '{\\n  \\\"ok\\\": true\\n}' });",
    "});",
  ].join("\n")
);

(async () => {
  const tools = new ToolProcessExecutor({ workerPath: worker });
  try {
    await assert.rejects(
      tools.execute("stop", {}),
      /MCP tool process stopped before stop ended/,
      "a stopped child must fail the active call without a retry"
    );
    assert.equal(await tools.execute("next", {}), '{\n  "ok": true\n}', "the next call starts a fresh child");
  } finally {
    tools.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write("mcp-tool-process-lifecycle-smoke: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

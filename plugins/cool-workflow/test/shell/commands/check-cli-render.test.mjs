#!/usr/bin/env node
// check-cli-render — the one TTY line `cw check` prints for pass, fail and
// "passed but not citable", the list/show human views, and that MCP's
// cw_check_list / cw_check_show give the same payload as the CLI --json.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { formatCheckList, formatCheckRun, formatCheckShow } from "../../../dist/shell/commands/check-cli.js";
import { findCapability } from "../../../dist/wiring/capability-table/index.js";
import { cw } from "../../helpers/cw.mjs";
import { tmpDir } from "../../helpers/workspace.mjs";

process.env.NO_COLOR = "1";
const base = { schemaVersion: 1, id: "rc-0123456789abcdef", cite: "receipt:rc-0123456789abcdef", path: "/r/.cw/receipts/rc-0123456789abcdef.json", argv: ["npm", "test"], signal: null, gitHead: "a".repeat(40), dirty: false, signed: false };

assert.equal(
  formatCheckRun({ ...base, ok: true, exitCode: 0, usable: true, code: null, reason: "", next: "cw check show rc-0123456789abcdef" }),
  "✓ passed: npm test (exit 0 at aaaaaaa) — receipt rc-0123456789abcdef. Cite it as receipt:rc-0123456789abcdef. Next: cw check show rc-0123456789abcdef"
);
assert.equal(
  formatCheckRun({ ...base, ok: false, exitCode: 1, usable: false, code: "receipt-failed", reason: "x", next: "cw check -- npm test" }),
  "✗ failed: npm test (exit 1 at aaaaaaa) — receipt rc-0123456789abcdef records it. Fix the failure, then run: cw check -- npm test"
);
assert.match(
  formatCheckRun({ ...base, gitHead: null, ok: true, exitCode: 0, usable: false, code: "receipt-no-git", reason: "receipt rc-0123456789abcdef was made outside a git repo with a commit, so it cannot be tied to the code", next: 'git add -A && git commit -m "save work" && cw check -- npm test' }),
  /^! passed: npm test \(exit 0 at no commit\), but receipt rc-0123456789abcdef cannot be cited: .*\. Next: git add -A/
);
assert.equal(formatCheckList([]), "No receipts yet. Next: cw check -- npm test");
assert.match(formatCheckShow({ id: "rc-0123456789abcdef", cite: "receipt:rc-0123456789abcdef", usable: false, code: "receipt-not-found", reason: "receipt rc-0123456789abcdef was not found in .cw/receipts", next: "cw check list", receipt: null }), /\n  Next: cw check list$/);

// MCP and CLI read the same receipts the same way.
{
  const repo = tmpDir("cw-check-mcp-");
  const git = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q");
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git("config", k, v);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const made = JSON.parse(cw(["check", "--json", "--", process.execPath, "-e", "0"], { cwd: repo }).stdout);
  const cliList = JSON.parse(cw(["check", "list"], { cwd: repo }).stdout);
  assert.deepEqual(findCapability("check.list").mcp.handler({ cwd: repo }), cliList);
  const cliShow = JSON.parse(cw(["check", "show", made.id], { cwd: repo }).stdout);
  assert.deepEqual(findCapability("check.show").mcp.handler({ cwd: repo, id: made.id }), cliShow);
  assert.equal(cliShow.usable, true);
}

console.log("check-cli-render: ok");

#!/usr/bin/env node
// npm-scripts-portable-smoke — every npm script in package.json runs under
// cmd.exe as well as sh. npm runs scripts with cmd.exe on Windows, where
// `> /dev/null` is "The system cannot find the path specified": `npm test`
// and `npm run test:unit` (and so `cw check -- npm test`) failed there
// before a test ran. Plain argv and `&&` are fine in both shells.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"));
const posixOnly = [
  [/\/dev\/null/, "/dev/null (cmd.exe has no such path)"],
  [/'/, "single quotes (cmd.exe keeps them as part of the word)"],
  [/\$\{?[A-Za-z_]/, "$VAR (cmd.exe spells it %VAR%)"],
  [/(^|[;&|]\s*)(rm|cp|mv|true|false|export)\s/, "a POSIX shell command"],
];
const faults = [];
for (const [name, line] of Object.entries(pkg.scripts || {})) {
  for (const [pattern, why] of posixOnly) if (pattern.test(line)) faults.push(`${name}: ${why}: ${line}`);
}
assert.deepEqual(faults, [], `npm scripts must run under cmd.exe too:\n${faults.join("\n")}`);
console.log("npm-scripts-portable-smoke: PASS");

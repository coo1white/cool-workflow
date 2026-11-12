#!/usr/bin/env node
// trustcore-evidence-line-past-end — pins lineCitedPastEnd: a `path:line`
// or `path:a-b` locator whose line is past the end of the file it names is
// found, with the file's line count; a line in the file, a file not on
// disk, a URL or an opaque token is not (intent 2026-11-11, batch C2).

import assert from "node:assert/strict";
import { lineCitedPastEnd } from "../../../dist/core/trust/evidence-grounding.js";

const files = { "/repo/a.ts": "one\ntwo\nthree\n", "/repo/b.md": "only", "/repo/empty.txt": "" };
const ops = {
  exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
  isAbsolute: (p) => p.startsWith("/"),
  resolve: (base, rel) => `${base}/${rel}`,
};
const read = (p) => files[p];
const check = (evidence) => lineCitedPastEnd(evidence, ["/repo"], ops, read);

assert.equal(check(["a.ts:1", "a.ts:3", "a.ts:2-3", "b.md:1"]), null, "lines in the file pass");
assert.deepEqual(check(["a.ts:4"]), { path: "a.ts", line: 4, lines: 3 }, "a trailing newline is not a line");
assert.deepEqual(check(["a.ts:2-9"]), { path: "a.ts", line: 9, lines: 3 }, "the end of a range counts");
assert.deepEqual(check(["b.md:2"]), { path: "b.md", line: 2, lines: 1 }, "a last line with no newline counts");
assert.deepEqual(check(["empty.txt:1"]), { path: "empty.txt", line: 1, lines: 0 });
assert.deepEqual(check(["/repo/a.ts:40"]), { path: "/repo/a.ts", line: 40, lines: 3 }, "an absolute path");
assert.deepEqual(check(["a.ts:1", "a.ts:7", "b.md:9"]), { path: "a.ts", line: 7, lines: 3 }, "the first past-end locator is named");
assert.equal(check(["missing.ts:99", "https://example.com/x:99", "ns:value", "a.ts", "free text"]), null, "no file, no line, or no path is not this check");
assert.equal(lineCitedPastEnd("a.ts:9", ["/repo"], ops, read), null, "not an array");
console.log("trustcore-evidence-line-past-end: ok");

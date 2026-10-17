#!/usr/bin/env node
// cli-args-sharedhelpers — pins requireArg, isRecord, messageOf and countBy,
// the small helpers that were copied into many src/ files and now live once
// in core/util/cli-args.ts. Each old copy is written out below as it was, and
// the shared helper must give the same result (or throw the same error) for
// every input here. optionalArg takes the place of the same-body
// optionalString / stringOption / optionalStringArg copies, so it is held to
// those too. The last part holds the rule that a merged helper is defined
// once: a new copy in src/ fails this test.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  requireArg,
  isRecord,
  messageOf,
  countBy,
  optionalArg,
} from "../../../dist/core/util/cli-args.js";

const SRC = path.resolve(import.meta.dirname, "../../../src");

// The old copies, body for body (types taken out).
const oldOptionalString = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
function oldReq(value, label) {
  const s = value === undefined || value === null ? "" : String(value);
  if (!s) throw new Error(`Missing ${label}`);
  return s;
}
const oldIsRecord = [
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
];
const oldMessageOf = (error) => (error instanceof Error ? error.message : String(error));
function oldCountBy(values, key) {
  const counts = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}
function oldCountByTwoReads(values, key) {
  const counts = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] || 0) + 1;
  return counts;
}

const VALUES = [
  undefined, null, true, false, 0, 1, -1, NaN, 5n, "", " ", "  x  ", "y", "false", "0",
  [], ["a"], {}, { a: 1 }, Object.create(null), new Date(0), /re/, () => 1, Symbol.for("s"),
  new Error("boom"), new TypeError("bad type"), Object.assign(new Error("e"), { message: "" }),
];

function outcome(fn, ...args) {
  try {
    return { value: fn(...args) };
  } catch (error) {
    return { threw: error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error) };
  }
}

for (const value of VALUES) {
  assert.deepEqual(outcome(optionalArg, value), outcome(oldOptionalString, value), `optionalArg(${String(typeof value)})`);
  assert.deepEqual(outcome(requireArg, value, "run id"), outcome(oldReq, value, "run id"), `requireArg(${String(typeof value)})`);
  for (const old of oldIsRecord) assert.equal(isRecord(value), old(value), `isRecord(${String(typeof value)})`);
  assert.deepEqual(outcome(messageOf, value), outcome(oldMessageOf, value), `messageOf(${String(typeof value)})`);
}

// Fixed answers, so a change to both copies at once is caught too.
assert.equal(optionalArg("  x  "), "x");
assert.equal(requireArg(0, "n"), "0");
assert.equal(requireArg(false, "n"), "false");
assert.throws(() => requireArg("", "feedback id"), { message: "Missing feedback id" });
assert.throws(() => requireArg(null, "run id"), { message: "Missing run id" });
assert.equal(isRecord({}), true);
assert.equal(isRecord([]), false);
assert.equal(isRecord(null), false);
assert.equal(messageOf(new Error("boom")), "boom");
assert.equal(messageOf("text"), "text");
assert.equal(messageOf(undefined), "undefined");

const records = [
  { status: "open", severity: "high" },
  { status: "resolved", severity: "low" },
  { status: "open", severity: "low" },
  { status: "2", severity: "low" },
];
for (const key of [(r) => r.status, (r) => r.severity]) {
  const got = countBy(records, key);
  assert.deepEqual(got, oldCountBy(records, key));
  assert.deepEqual(got, oldCountByTwoReads(records, key));
  assert.deepEqual(Object.keys(got), Object.keys(oldCountBy(records, key)));
}
assert.deepEqual(countBy(records, (r) => r.status), { 2: 1, open: 2, resolved: 1 });
assert.deepEqual(countBy([], (r) => r), {});

// Each merged helper is defined in exactly one src/ file.
function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
const files = sourceFiles(SRC).map((file) => ({ rel: path.relative(SRC, file), text: fs.readFileSync(file, "utf8") }));
function definedIn(name) {
  const re = new RegExp(`^(export )?function ${name}\\b`, "m");
  return files.filter((file) => re.test(file.text)).map((file) => file.rel.split(path.sep).join("/")).sort();
}
for (const name of ["requireArg", "isRecord", "messageOf", "countBy", "optionalArg"]) {
  assert.deepEqual(definedIn(name), ["core/util/cli-args.ts"], `${name} has one home`);
}
assert.deepEqual(definedIn("req"), []);
assert.deepEqual(definedIn("optionalStringArg"), []);
// Kept on purpose: audit-cli.ts reads an array's first string too, and
// registry-core.ts and orchestrator.ts are capability surface files.
// scheduler-io.ts's stringOption (`true` is unset, other values String())
// has its only twin in orchestrator.ts.
assert.deepEqual(definedIn("optionalString"), ["shell/audit-cli.ts", "wiring/capability-table/registry-core.ts"]);
assert.deepEqual(definedIn("stringOption"), ["shell/orchestrator.ts", "shell/scheduler-io.ts"]);

console.log("cli-args-sharedhelpers: ok");

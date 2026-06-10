#!/usr/bin/env node
"use strict";

// schema-validation-smoke (Track 3) — declared output schemas are ENFORCED at
// result intake (the other half of "auditable": Track 1 proves telemetry is real,
// this proves the result SHAPE is what was declared). Proves:
//   VALIDATOR (dependency-free subset):
//     type (incl. integer/null/type-arrays), enum, const, required, properties
//     (nested), additionalProperties:false, items; unknown keywords ignored
//     (never a false fail); malformed schema never throws;
//   VERIFIER GATE (validateResultEnvelope — the exact fn the drive calls):
//     a schema'd task with a conforming result passes; a violating result THROWS
//     (⇒ the drive parks the hop, fail-closed); a task with NO schema is unaffected.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { validateAgainstSchema } = require(path.join(pluginRoot, "dist/schema-validate.js"));
const { validateResultEnvelope } = require(path.join(pluginRoot, "dist/verifier.js"));

function ok(value, schema, msg) {
  assert.deepEqual(validateAgainstSchema(value, schema), [], msg);
}
function bad(value, schema, msg) {
  assert.ok(validateAgainstSchema(value, schema).length > 0, msg);
}

function main() {
  // ---- VALIDATOR units ----------------------------------------------------
  // type
  ok({}, { type: "object" }, "object ok");
  bad([], { type: "object" }, "array is not object");
  bad(null, { type: "object" }, "null is not object");
  ok([], { type: "array" }, "array ok");
  ok("x", { type: "string" }, "string ok");
  bad(1, { type: "string" }, "number is not string");
  ok(3, { type: "integer" }, "integer ok");
  bad(3.5, { type: "integer" }, "float is not integer");
  ok(3.5, { type: "number" }, "number ok");
  ok(true, { type: "boolean" }, "boolean ok");
  ok(null, { type: "null" }, "null ok");
  // type as array
  ok("x", { type: ["string", "null"] }, "string matches union");
  ok(null, { type: ["string", "null"] }, "null matches union");
  bad(1, { type: ["string", "null"] }, "number not in union");

  // enum / const
  ok("APPROVED", { enum: ["APPROVED", "REJECTED"] }, "enum member ok");
  bad("maybe", { enum: ["APPROVED", "REJECTED"] }, "enum non-member");
  ok(42, { const: 42 }, "const ok");
  bad(43, { const: 42 }, "const mismatch");

  // required + properties (nested)
  const personSchema = { type: "object", required: ["name", "age"], properties: { name: { type: "string" }, age: { type: "integer" } } };
  ok({ name: "a", age: 3 }, personSchema, "object meets required + property types");
  bad({ name: "a" }, personSchema, "missing required age");
  bad({ name: "a", age: "old" }, personSchema, "age wrong type");

  // additionalProperties:false
  const strict = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false };
  ok({ a: "x" }, strict, "only declared props ok");
  bad({ a: "x", b: 1 }, strict, "extra prop rejected");

  // items (every element)
  const listSchema = { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" } } } };
  ok([{ id: "1" }, { id: "2" }], listSchema, "all items conform");
  bad([{ id: "1" }, {}], listSchema, "one item missing id");

  // robustness: unknown keyword ignored; malformed schema never throws
  ok({ anything: true }, { type: "object", pattern: "^x$" }, "unsupported keyword (pattern) is ignored, not a false fail");
  assert.deepEqual(validateAgainstSchema({}, null), [], "null schema ⇒ no errors (never throws)");
  ok({ a: 1 }, {}, "empty schema accepts anything");

  // ---- VERIFIER GATE integration ------------------------------------------
  const schema = {
    type: "object",
    required: ["summary", "findings"],
    properties: {
      summary: { type: "string", enum: ["APPROVED", "REJECTED"] },
      findings: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" } } } }
    }
  };
  const task = (extra = {}) => ({ id: "t-schema", kind: "agent", phase: "p", status: "running", requiresEvidence: false, prompt: "x", taskPath: "", resultPath: "", loopStage: "observe", ...extra });

  // conforming result passes
  validateResultEnvelope(task({ schema }), { summary: "APPROVED", findings: [{ id: "f1" }], evidence: [] });

  // enum violation ⇒ throws
  assert.throws(
    () => validateResultEnvelope(task({ schema }), { summary: "maybe", findings: [{ id: "f1" }], evidence: [] }),
    /violates declared schema/,
    "summary enum violation parks the hop"
  );
  // missing required ⇒ throws
  assert.throws(
    () => validateResultEnvelope(task({ schema }), { summary: "APPROVED", evidence: [] }),
    /violates declared schema/,
    "missing required findings parks the hop"
  );
  // bad item shape ⇒ throws (id present-but-wrong-type passes the built-in
  // finding check, so this isolates the SCHEMA failure path)
  assert.throws(
    () => validateResultEnvelope(task({ schema }), { summary: "APPROVED", findings: [{ id: 123 }], evidence: [] }),
    /violates declared schema/,
    "finding id wrong type parks the hop via the schema check"
  );
  // NO schema declared ⇒ unaffected (the same shape passes)
  validateResultEnvelope(task(), { summary: "anything goes", findings: [{ id: "f1" }], evidence: [] });

  console.log("schema-validation-smoke: ok (validator subset; declared schema enforced at intake, violations park, no-schema unaffected)");
}

main();

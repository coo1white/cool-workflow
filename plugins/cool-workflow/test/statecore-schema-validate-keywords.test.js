#!/usr/bin/env node
// statecore-schema-validate-keywords (milestone 3) — pins
// validateAgainstSchema's per-keyword behavior: type (incl. arrays of
// types, integer, null), const, enum, required, properties,
// additionalProperties:false, items. SPEC/state-core.md
// "dependency-free JSON-schema subset" section
// (now src/core/state/schema-validate.ts), "Schema-validator error strings".

const assert = require("node:assert/strict");
const { validateAgainstSchema } = require("../dist/core/state/schema-validate");

// type: string.
{
  assert.deepEqual(validateAgainstSchema("hello", { type: "string" }), []);
  assert.deepEqual(validateAgainstSchema(42, { type: "string" }), ["$: expected type string, got number"]);
}

// type: integer (rejects non-integer numbers).
{
  assert.deepEqual(validateAgainstSchema(5, { type: "integer" }), []);
  assert.deepEqual(validateAgainstSchema(5.5, { type: "integer" }), ["$: expected type integer, got number"]);
}

// type: null.
{
  assert.deepEqual(validateAgainstSchema(null, { type: "null" }), []);
  assert.deepEqual(validateAgainstSchema(0, { type: "null" }), ["$: expected type null, got number"]);
}

// type: array of acceptable types (union).
{
  assert.deepEqual(validateAgainstSchema("x", { type: ["string", "number"] }), []);
  assert.deepEqual(validateAgainstSchema(5, { type: ["string", "number"] }), []);
  assert.deepEqual(validateAgainstSchema(true, { type: ["string", "number"] }), ["$: expected type string|number, got boolean"]);
}

// type mismatch STOPS downstream keyword checks at that level (no
// duplicate/noise errors from required/properties when type already
// failed).
{
  const errors = validateAgainstSchema("not-an-object", {
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" } },
  });
  assert.deepEqual(errors, ["$: expected type object, got string"], "a type mismatch must short-circuit further keyword checks");
}

// const.
{
  assert.deepEqual(validateAgainstSchema("fixed", { const: "fixed" }), []);
  assert.deepEqual(validateAgainstSchema("other", { const: "fixed" }), ['$: expected const "fixed"']);
}

// enum.
{
  assert.deepEqual(validateAgainstSchema("b", { enum: ["a", "b", "c"] }), []);
  assert.deepEqual(validateAgainstSchema("z", { enum: ["a", "b", "c"] }), ['$: "z" is not one of ["a","b","c"]']);
}

// required: missing property.
{
  assert.deepEqual(validateAgainstSchema({ a: 1 }, { required: ["a", "b"] }), ['$: missing required property "b"']);
}

// properties: recurses into sub-schemas with an extended path.
{
  const errors = validateAgainstSchema({ name: 42 }, { properties: { name: { type: "string" } } });
  assert.deepEqual(errors, ["$.name: expected type string, got number"]);
}

// additionalProperties: false.
{
  const errors = validateAgainstSchema(
    { known: 1, extra: 2 },
    { properties: { known: { type: "number" } }, additionalProperties: false }
  );
  assert.deepEqual(errors, ['$: additional property "extra" is not allowed']);
}

// additionalProperties: false does NOT flag properties that ARE declared.
{
  const errors = validateAgainstSchema({ known: 1 }, { properties: { known: { type: "number" } }, additionalProperties: false });
  assert.deepEqual(errors, []);
}

// items: validates each array element, with indexed paths.
{
  const errors = validateAgainstSchema([1, "two", 3], { type: "array", items: { type: "number" } });
  assert.deepEqual(errors, ["$[1]: expected type number, got string"]);
}

// Nested path formatting: "$.field[0].sub".
{
  const errors = validateAgainstSchema(
    { list: [{ sub: 5 }] },
    { properties: { list: { type: "array", items: { type: "object", properties: { sub: { type: "string" } } } } } }
  );
  assert.deepEqual(errors, ["$.list[0].sub: expected type string, got number"]);
}

// Unsupported keywords ($ref, allOf, pattern, etc.) are silently ignored
// (never enforced) — validating against a schema with only unsupported
// keywords always passes.
{
  const errors = validateAgainstSchema("anything", { pattern: "^[0-9]+$", format: "email" });
  assert.deepEqual(errors, [], "unsupported keywords must never be enforced");
}

// An unknown declared `type` string is NOT enforced (never a false fail).
{
  const errors = validateAgainstSchema(12345, { type: "some-future-type" });
  assert.deepEqual(errors, [], "an unrecognized type string must not cause a false failure");
}

// A malformed schema (not an object) never throws — returns no errors.
{
  assert.deepEqual(validateAgainstSchema("x", null), []);
  assert.deepEqual(validateAgainstSchema("x", undefined), []);
  assert.deepEqual(validateAgainstSchema("x", "not-a-schema-object"), []);
}

// Multiple simultaneous violations at the same level all get reported
// (const AND enum can both fire together, for instance).
{
  const errors = validateAgainstSchema("z", { const: "a", enum: ["a", "b"] });
  assert.equal(errors.length, 2, "both const and enum violations at the same level must both be reported");
}

process.stdout.write("statecore-schema-validate-keywords: ok\n");

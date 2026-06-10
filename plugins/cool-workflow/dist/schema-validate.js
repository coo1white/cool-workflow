"use strict";
// Minimal, dependency-free structural schema validation (Track 3).
//
// CW declares an optional output `schema` per task (WorkflowTaskDefinition.schema);
// this enforces it at result-acceptance time so CW only records structured output
// it has actually validated — the other half of "auditable" (Track 1 proves the
// telemetry is real; this proves the result SHAPE is what was declared).
//
// DELIBERATELY a subset of JSON Schema, NOT a full implementation: it adds NO
// runtime dependency (the portability red line — CI runs on node/npm/git only).
// Supported keywords cover structured-agent-output contracts:
//   type (object|array|string|number|integer|boolean|null, or an array of them),
//   enum, const, required, properties, additionalProperties (false), items.
// Unsupported keywords ($ref, allOf/anyOf/oneOf, pattern, formats, numeric
// bounds) are IGNORED — never silently "passed" as a constraint that wasn't
// checked; a schema relying on them simply isn't enforced for those keywords.
// (If full JSON Schema is needed later, swap this module's impl for ajv behind
// the same signature.)
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAgainstSchema = validateAgainstSchema;
function typeOf(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value; // object | string | number | boolean | undefined | function
}
function matchesType(value, type) {
    switch (type) {
        case "object":
            return value !== null && typeof value === "object" && !Array.isArray(value);
        case "array":
            return Array.isArray(value);
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "boolean":
            return typeof value === "boolean";
        case "null":
            return value === null;
        default:
            return true; // unknown declared type ⇒ not enforced (never a false fail)
    }
}
/** Validate `value` against `schema`. Returns a list of human-readable errors;
 *  empty ⇒ valid. Pure + deterministic; never throws on a malformed schema (an
 *  unparseable schema constraint is skipped, not treated as a failure). */
function validateAgainstSchema(value, schema, path = "$") {
    const errors = [];
    if (!schema || typeof schema !== "object")
        return errors;
    // type
    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type.map(String) : [String(schema.type)];
        if (!types.some((t) => matchesType(value, t))) {
            errors.push(`${path}: expected type ${types.join("|")}, got ${typeOf(value)}`);
            return errors; // type mismatch ⇒ downstream keyword checks would be noise
        }
    }
    // const / enum
    if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
        errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
        errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    }
    // object: required, properties, additionalProperties:false
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const obj = value;
        if (Array.isArray(schema.required)) {
            for (const key of schema.required) {
                if (!(String(key) in obj))
                    errors.push(`${path}: missing required property "${String(key)}"`);
            }
        }
        const properties = (schema.properties && typeof schema.properties === "object" ? schema.properties : {});
        for (const [key, subSchema] of Object.entries(properties)) {
            if (key in obj)
                errors.push(...validateAgainstSchema(obj[key], subSchema, `${path}.${key}`));
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(obj)) {
                if (!(key in properties))
                    errors.push(`${path}: additional property "${key}" is not allowed`);
            }
        }
    }
    // array: items (single schema applied to every element)
    if (Array.isArray(value) && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
        value.forEach((element, index) => {
            errors.push(...validateAgainstSchema(element, schema.items, `${path}[${index}]`));
        });
    }
    return errors;
}

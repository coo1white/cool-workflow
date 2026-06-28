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
// bounds) are surfaced as WARNINGS (a constraint that wasn't checked), so the
// operator can see their schema reliance is incomplete.
// (If full JSON Schema is needed later, swap this module's impl for ajv behind
// the same signature.)

export type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // object | string | number | boolean | undefined | function
}

function matchesType(value: unknown, type: string): boolean {
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
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object") return errors;

  // Unsupported keywords — surface as diagnostics (Rule of Silence: stderr)
  const UNSUPPORTED = new Set(["$ref", "allOf", "anyOf", "oneOf", "not", "pattern", "format", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "contains", "if", "then", "else"]);
  const unsupported = Object.keys(schema).filter((k) => UNSUPPORTED.has(k));
  if (unsupported.length && process.stderr.isTTY) {
    process.stderr.write(`[cw] schema at ${path}: unsupported keywords ignored: ${unsupported.join(", ")}\n`);
  }

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
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(String(key) in obj)) errors.push(`${path}: missing required property "${String(key)}"`);
      }
    }
    const properties = (schema.properties && typeof schema.properties === "object" ? schema.properties : {}) as Record<string, JsonSchema>;
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in obj) errors.push(...validateAgainstSchema(obj[key], subSchema, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) errors.push(`${path}: additional property "${key}" is not allowed`);
      }
    }
  }

  // array: items (single schema applied to every element)
  if (Array.isArray(value) && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    value.forEach((element, index) => {
      errors.push(...validateAgainstSchema(element, schema.items as JsonSchema, `${path}[${index}]`));
    });
  }

  return errors;
}

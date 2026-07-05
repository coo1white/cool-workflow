// core/state/schema-validate.ts — dependency-free JSON-schema subset.
//
// MILESTONE 3. Byte-exact port of the old build's src/schema-validate.ts.
// Deliberately a SUBSET of JSON Schema (type, const, enum, required,
// properties, additionalProperties:false, items) — adds no runtime
// dependency. Unsupported keywords are surfaced as a stderr diagnostic
// (TTY only), never enforced.
//
// Evidence: SPEC/state-core.md "src/schema-validate.ts — dependency-free
// JSON-schema subset", "Schema-validator error strings".

export type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
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
      return true; // unknown declared type => not enforced (never a false fail)
  }
}

const UNSUPPORTED_KEYWORDS = new Set([
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "if",
  "then",
  "else",
]);

/** Validate `value` against `schema`. Returns a list of human-readable
 *  errors; empty means valid. Pure + deterministic; never throws on a
 *  malformed schema. */
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object") return errors;

  const unsupported = Object.keys(schema).filter((k) => UNSUPPORTED_KEYWORDS.has(k));
  if (unsupported.length && process.stderr.isTTY) {
    process.stderr.write(`[cw] schema at ${path}: unsupported keywords ignored: ${unsupported.join(", ")}\n`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type.map(String) : [String(schema.type)];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${typeOf(value)}`);
      return errors; // type mismatch => downstream keyword checks would be noise
    }
  }

  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(String(key) in obj)) errors.push(`${path}: missing required property "${String(key)}"`);
      }
    }
    const properties = (schema.properties && typeof schema.properties === "object" ? schema.properties : {}) as Record<
      string,
      JsonSchema
    >;
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in obj) errors.push(...validateAgainstSchema(obj[key], subSchema, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) errors.push(`${path}: additional property "${key}" is not allowed`);
      }
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    value.forEach((element, index) => {
      errors.push(...validateAgainstSchema(element, schema.items as JsonSchema, `${path}[${index}]`));
    });
  }

  return errors;
}

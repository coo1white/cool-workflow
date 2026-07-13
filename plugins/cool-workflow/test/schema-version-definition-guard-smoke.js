#!/usr/bin/env node
"use strict";

// A schema domain has one version definition in its inventory source.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { validateSchemaVersionInventory } = require(path.join(pluginRoot, "scripts", "validate-run-state-schema.js"));
const coreDrive = require(path.join(pluginRoot, "dist", "core", "pipeline", "drive-decide.js"));
const shellDrive = require(path.join(pluginRoot, "dist", "shell", "drive.js"));

assert.equal(shellDrive.DRIVE_SCHEMA_VERSION, coreDrive.DRIVE_SCHEMA_VERSION, "shell keeps the core schema version export");

const inventory = {
  schemaVersion: 1,
  domains: [
    { domain: "run", constant: "RUN_SCHEMA_VERSION", source: "core/run.ts" },
  ],
};
const source = "export const RUN_SCHEMA_VERSION = 1;\n";

assert.deepEqual(
  validateSchemaVersionInventory(inventory, [{ path: "core/run.ts", source }]),
  [],
  "one canonical definition passes",
);

const duplicate = validateSchemaVersionInventory(inventory, [
  { path: "core/run.ts", source },
  { path: "shell/run.ts", source },
]);
assert.ok(duplicate.some((error) => error.includes("more than one definition")), "a second definition fails");

const unknown = validateSchemaVersionInventory(inventory, [
  { path: "core/run.ts", source },
  { path: "core/new.ts", source: "export const NEW_SCHEMA_VERSION = 1;\n" },
]);
assert.ok(unknown.some((error) => error.includes("Unknown schema version domain")), "an unknown domain fails");

const stale = validateSchemaVersionInventory({
  schemaVersion: 1,
  domains: [
    ...inventory.domains,
    { domain: "old", constant: "OLD_SCHEMA_VERSION", source: "core/old.ts" },
  ],
}, [{ path: "core/run.ts", source }]);
assert.ok(stale.some((error) => error.includes("has no definition")), "an entry with no definition fails");

const wrongSource = validateSchemaVersionInventory(inventory, [
  { path: "shell/run.ts", source },
]);
assert.ok(wrongSource.some((error) => error.includes("must be defined in core/run.ts")), "a wrong source fails");

process.stdout.write("schema-version-definition-guard-smoke: ok\n");

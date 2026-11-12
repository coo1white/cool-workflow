#!/usr/bin/env node

// Single source of truth for the CANONICAL app id list.
//
// Audit finding M5: this list was hand-copied into several scripts
// (bump-version.mjs, version-sync-check.mjs) with no gate
// enforcing agreement, so drift between the copies was silent. This module
// DERIVES the list from the `apps/` directory on disk so the callers can
// never disagree — there is nothing left to copy.
//
// What counts as canonical: every app directory under `apps/` whose `app.json`
// is NOT a demo (`metadata.example === true`). Example apps are excluded
// because they are version-pinned and must not be bumped with the runtime.
//
// Portability: node fs/path only, no external tools (CI portability rule).

import fs from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const appsDir = path.join(pluginRoot, "apps");

function isExampleApp(appJsonPath) {
  // An app is excluded from the canonical list iff its app.json declares
  // metadata.example === true. Any read/parse failure is treated as
  // "not an example" so a malformed app surfaces in the canonical list (and
  // therefore in the version gate) rather than being silently dropped.
  try {
    const json = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    return json && json.metadata && json.metadata.example === true;
  } catch {
    return false;
  }
}

function listCanonicalAppIds() {
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => {
      const appJson = path.join(appsDir, id, "app.json");
      if (!fs.existsSync(appJson)) return false; // not an app directory
      return !isExampleApp(appJson);
    })
    .sort(); // deterministic order (replay determinism)
}

const CANONICAL_APP_IDS = listCanonicalAppIds();

export {
  CANONICAL_APP_IDS,
  listCanonicalAppIds
};

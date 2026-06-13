#!/usr/bin/env node
"use strict";

// Single source of truth for the CANONICAL app id list.
//
// Audit finding M5: this list was hand-copied into three scripts
// (bump-version.js, version-sync-check.js, canonical-apps.js) with no gate
// enforcing agreement, so drift between the copies was silent. This module
// DERIVES the list from the `apps/` directory on disk so the three callers can
// never disagree — there is nothing left to copy.
//
// What counts as canonical: every app directory under `apps/` whose `app.json`
// is NOT a demo. The real demo marker is `metadata.example === true` (that, NOT
// `versionPinned`, is how the only non-canonical app — workflow-app-framework-demo,
// pinned at 0.1.0 — is flagged). Example apps are excluded because they are
// version-pinned and must not be bumped or version-asserted with the runtime.
//
// Portability: node fs/path only, no external tools (CI portability rule).

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const appsDir = path.join(pluginRoot, "apps");

// The end-to-end golden path is canonical (and version-tracked) but is exercised
// by its own dedicated harness (scripts/golden-path.js), not by the per-app CLI
// smoke in canonical-apps.js. Expose its id so that script can express
// "canonical minus golden-path" without re-introducing a hand-copied list.
const GOLDEN_PATH_APP_ID = "end-to-end-golden-path";

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

module.exports = {
  CANONICAL_APP_IDS,
  listCanonicalAppIds,
  GOLDEN_PATH_APP_ID
};

#!/usr/bin/env bash
# verify-audit-cites.sh — pre-publish cite checker for CW audits.
#
# Extracts every `file.ext:NNN` / `file.ext:NNN-MMM` locator from an audit markdown
# file and verifies, for each one, that:
#   1. the file EXISTS under the search root (default plugins/cool-workflow/src), and
#   2. the cited line number(s) are IN RANGE (<= the file's line count).
#
# It does NOT prove claim-correctness — that is the human reviewer's job (see
# docs/publishing-audits.md, "Cite-verification methodology"). This catches stale
# and fabricated locators before they reach a published report.
#
# Portable: bash + node + grep only (no rg), matching CW's CI portability rule.
#
# Usage:
#   bash docs/scripts/verify-audit-cites.sh <audit.md> [search-root]
# Exit: 0 = all cites resolve and are in range; 1 = one or more failed; 2 = bad usage.

set -euo pipefail

AUDIT="${1:-}"
ROOT="${2:-plugins/cool-workflow/src}"

if [ -z "$AUDIT" ] || [ ! -f "$AUDIT" ]; then
  echo "usage: bash docs/scripts/verify-audit-cites.sh <audit.md> [search-root]" >&2
  exit 2
fi
if [ ! -d "$ROOT" ]; then
  echo "search root not found: $ROOT" >&2
  exit 2
fi

# Extract candidate locators: <name>.<ext>:<line>[-<line>]. Dedup, preserve nothing
# but the locator token. -o prints only the match; -E for extended regex; -h hides
# filenames; we then strip surrounding backticks/punctuation node-side.
LOCATORS="$(grep -oE '[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+(-[0-9]+)?' "$AUDIT" | sort -u || true)"

if [ -z "$LOCATORS" ]; then
  echo "no file:line locators found in $AUDIT" >&2
  exit 2
fi

# Hand the locator list + root to node for existence + line-range checks.
printf '%s\n' "$LOCATORS" | ROOT="$ROOT" node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.ROOT;
const input = fs.readFileSync(0, "utf8").split(/\n/).map(s => s.trim()).filter(Boolean);

let ok = 0, fail = 0;
const fails = [];

// A locator file part may be cited relative to the search root (e.g. "verifier.ts:40")
// OR repo-relative (e.g. "plugins/cool-workflow/test/x.js"). Try both.
function resolveFile(filePart) {
  const candidates = [path.join(root, filePart), filePart];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

for (const loc of input) {
  const m = loc.match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (!m) { continue; }
  const [, filePart, startStr, endStr] = m;
  const file = resolveFile(filePart);
  if (!file) { fail++; fails.push(`MISSING FILE   ${loc}`); continue; }
  const lines = fs.readFileSync(file, "utf8").split(/\n/).length;
  const start = Number(startStr);
  const end = endStr ? Number(endStr) : start;
  if (start < 1 || end < start || end > lines) {
    fail++; fails.push(`LINE OUT OF RANGE ${loc} (file has ${lines} lines)`);
    continue;
  }
  ok++;
}

if (fail) {
  console.error(`\nFAILED cite checks (${fail}):`);
  for (const f of fails) console.error("  - " + f);
  console.error(`\n${ok} cite(s) resolved, ${fail} failed.`);
  console.error("NOTE: existence + line-range only; claim-correctness needs a human reviewer.");
  process.exit(1);
}

console.log(`All ${ok} file:line cite(s) resolved and are in range under ${root}.`);
console.log("NOTE: existence + line-range only; claim-correctness needs a human reviewer.");
'

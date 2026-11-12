#!/usr/bin/env node
// bump-version-idempotent-smoke — `bump:version <current>` must be a no-op
// for the STRUCTURED surfaces that exits 0 ("already at"), not a hard failure.
// The gated `release-flow --cut` relies on this when the version surfaces were
// already bumped in a prior PR (release-prep), so the cut can still commit the
// verdict + tag without re-bumping. Pins: idempotent re-run, no surface
// mutation, AND (post-v0.2.3 fix) that the same-version early-exit still runs
// the CONTENT-surface gate — the v0.2.3 cut hit exactly that hole: package.json
// was already bumped, so the early-exit skipped the content check entirely and
// `--content` never filled the missing docs/RELEASE references, which then
// failed only much later, inside the cut.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const bump = path.join(pluginRoot, "scripts", "bump-version.mjs");
const pkgPath = path.join(pluginRoot, "package.json");

const current = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
const pkgBefore = fs.readFileSync(pkgPath, "utf8");

// Re-bumping to the CURRENT version is a no-op success (exit 0), not a fail.
const r = spawnSync(process.execPath, [bump, current], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(r.status, 0, `bump:version ${current} (already at) must exit 0, got ${r.status}\n${r.stdout}${r.stderr}`);
assert.match(`${r.stdout}${r.stderr}`, /already at/, "idempotent run reports 'already at'");

// And it must not have rewritten any surface (package.json byte-identical).
assert.equal(fs.readFileSync(pkgPath, "utf8"), pkgBefore, "no-op bump must not mutate package.json");

// A malformed version still fails closed.
const bad = spawnSync(process.execPath, [bump, "not-a-version"], { cwd: pluginRoot, encoding: "utf8" });
assert.notEqual(bad.status, 0, "a non-semver version must fail closed");

// A same-version re-run with a MISSING content surface must FAIL (gate mode).
// Fixture: a minimal <root>/plugins/cool-workflow layout (bump-version resolves
// repoRoot from its own __dirname) whose package.json is already at the target
// version but whose durable-state-and-locking.7.md lacks any mention of it. The
// pre-fix code early-exited 0 here without ever looking at content surfaces.
{
  const root = tmpDir("cw-bump-gate-");
  const fixPlugin = path.join(root, "plugins", "cool-workflow");
  fs.mkdirSync(path.join(fixPlugin, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixPlugin, "apps"), { recursive: true });
  fs.mkdirSync(path.join(fixPlugin, "docs"), { recursive: true });
  fs.copyFileSync(bump, path.join(fixPlugin, "scripts", "bump-version.mjs"));
  fs.copyFileSync(
    path.join(pluginRoot, "scripts", "canonical-apps-list.mjs"),
    path.join(fixPlugin, "scripts", "canonical-apps-list.mjs")
  );
  fs.writeFileSync(path.join(fixPlugin, "package.json"), `${JSON.stringify({ name: "x", version: "9.9.0", scripts: {} }, null, 2)}\n`);
  const surfacePath = path.join(fixPlugin, "docs", "durable-state-and-locking.7.md");
  fs.writeFileSync(surfacePath, "# Durable State & Locking\n\nno version mention here\n");

  const gate = spawnSync(process.execPath, [path.join(fixPlugin, "scripts", "bump-version.mjs"), "9.9.0"], {
    cwd: fixPlugin,
    encoding: "utf8"
  });
  assert.notEqual(gate.status, 0, "same-version re-run must still FAIL the content gate when a surface is missing (pre-fix: silent exit 0)");
  assert.match(`${gate.stdout}${gate.stderr}`, /durable-state-and-locking\.7\.md/, "the failure must name the missing surface");

  // And --content on the same-version re-run must actually FILL the missing
  // surface — the exact v0.2.3 incident: `bump:version -- 0.2.3 --content`
  // early-exited without appending anything, leaving the content gap in
  // place. --content re-runs `npm run version:sync` afterwards, so give the
  // fixture a stub script for it.
  const pkg = JSON.parse(fs.readFileSync(path.join(fixPlugin, "package.json"), "utf8"));
  pkg.scripts["version:sync"] = "exit 0";
  fs.writeFileSync(path.join(fixPlugin, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const fill = spawnSync(process.execPath, [path.join(fixPlugin, "scripts", "bump-version.mjs"), "9.9.0", "--content"], {
    cwd: fixPlugin,
    encoding: "utf8"
  });
  assert.equal(fill.status, 0, `same-version --content must fill and exit 0:\n${fill.stdout}${fill.stderr}`);
  assert.match(
    fs.readFileSync(surfacePath, "utf8"),
    /^9\.9\.0$/m,
    "--content on a same-version re-run must append the version to the missing surface (pre-fix: it never did)"
  );

  // A patch needs no man-page line of its own: its footer line is the
  // minor's X.Y.0 (patches ship automatically and add no --content lines,
  // release-tooling(7), "Automatic patch releases"). Gate mode at 9.9.1
  // passes on the 9.9.0 line just added, and appends nothing.
  pkg.version = "9.9.1";
  fs.writeFileSync(path.join(fixPlugin, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  // Every content surface the gate named above, each with the 9.9.0 line.
  const surfaces = [...new Set(`${gate.stdout}${gate.stderr}`.match(/plugins\/cool-workflow\/docs\/[\w.-]+\.7\.md/g))];
  assert.ok(surfaces.length > 1, "the gate lists the content surfaces");
  for (const rel of surfaces) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, "# page\n\n9.9.0\n");
  }
  const before = fs.readFileSync(surfacePath, "utf8");
  const patch = spawnSync(process.execPath, [path.join(fixPlugin, "scripts", "bump-version.mjs"), "9.9.1"], {
    cwd: fixPlugin,
    encoding: "utf8"
  });
  assert.equal(patch.status, 0, `a patch must pass the content gate on its minor's line (pre-fix: it asked for 9.9.1):\n${patch.stdout}${patch.stderr}`);
  assert.equal(fs.readFileSync(surfacePath, "utf8"), before, "a patch adds no man-page line");
  // And without the minor's line the patch still fails closed, naming it.
  fs.writeFileSync(surfacePath, "# Durable State & Locking\n\nno version mention here\n");
  const patchGate = spawnSync(process.execPath, [path.join(fixPlugin, "scripts", "bump-version.mjs"), "9.9.1"], {
    cwd: fixPlugin,
    encoding: "utf8"
  });
  assert.notEqual(patchGate.status, 0, "a patch with no X.Y.0 line still fails the content gate");
  assert.match(`${patchGate.stdout}${patchGate.stderr}`, /must contain "9\.9\.0"/, "the failure names the minor's line");
}

process.stdout.write("bump-version-idempotent-smoke: ok (re-bump is a structured no-op exit 0; surfaces untouched; bad version fails closed; same-version re-run still gates content)\n");

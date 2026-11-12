#!/usr/bin/env node
// @cw-smoke: tags pages
// site-snapshot-smoke — the GitHub Pages snapshot script, end to end: two
// run folders under a temp repo's .cw/runs/, then
// `node scripts/site-snapshot.mjs <tmp> <repo>` must publish the NEWEST
// run's report.md as index.html and report.html (plus .nojekyll); a repo
// with no run is a refusal (exit 1), not an empty site.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(pluginRoot, "scripts", "site-snapshot.mjs");

const repo = tmpDir("cw-site-repo-");
for (const [id, title] of [["run-a", "Older"], ["run-b", "Newest"]]) {
  const dir = path.join(repo, ".cw", "runs", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "report.md"), `# ${title} report\n`);
}

const site = tmpDir("cw-site-snapshot-");
const run = spawnSync(process.execPath, [script, site, repo], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(run.status, 0, `site-snapshot.mjs exited 0: ${run.stderr}`);
assert.ok(fs.existsSync(path.join(site, ".nojekyll")), ".nojekyll");
const index = fs.readFileSync(path.join(site, "index.html"), "utf8");
assert.ok(index.includes("Newest report"), "index.html is the newest run's report");
assert.equal(fs.readFileSync(path.join(site, "report.html"), "utf8"), index, "report.html is the same page");

const empty = tmpDir("cw-site-empty-");
const refused = spawnSync(process.execPath, [script, path.join(empty, "site"), empty], { cwd: pluginRoot, encoding: "utf8" });
assert.equal(refused.status, 1, "no run is a refusal");
assert.match(refused.stderr, /^site-snapshot: no run with a report\.md under /);

for (const d of [repo, site, empty]) fs.rmSync(d, { recursive: true, force: true });
process.stdout.write("site-snapshot-smoke: ok\n");

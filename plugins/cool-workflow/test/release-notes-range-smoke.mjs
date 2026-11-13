// release-notes-range-smoke — the GitHub Release notes list only what
// changed since the previous release.
//
// A release tag sits on a bump commit made beside main, never on main, so no
// earlier release tag is an ancestor of a new one. `gh release create
// --generate-notes` with no start tag then fell back to the last tag that IS
// an ancestor (v0.2.2), and every release from v0.3 on listed ~530 PRs
// (v0.5.0: "compare/v0.2.2...v0.5.0"). The fix names the start tag by
// version order: `release-tags.mjs previous <tag>`, passed as
// --notes-start-tag by both release steps in .github/workflows/release.yml.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const TAGS = path.join(pluginRoot, "scripts", "release-tags.mjs");
const WORKFLOW = path.resolve(pluginRoot, "..", "..", ".github", "workflows", "release.yml");

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(dir, msg) {
  fs.writeFileSync(path.join(dir, "f"), `${msg}\n`);
  git(dir, ["add", "f"]);
  git(dir, ["commit", "-q", "-m", msg]);
  return git(dir, ["rev-parse", "HEAD"]);
}
function previous(dir, tag) {
  return spawnSync(process.execPath, [TAGS, "previous", tag], { cwd: dir, encoding: "utf8" });
}

// main: A (tagged v0.2.2, on main) -> B -> C. v0.4.8 and v0.5.0 are tags on
// bump commits beside main (off B and C), the shape the release jobs make.
const dir = tmpDir("cw-notes-range-");
git(dir, ["init", "-q", "-b", "main"]);
for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"], ["tag.gpgSign", "false"]]) git(dir, ["config", k, v]);
commit(dir, "A");
git(dir, ["tag", "v0.2.2"]);
const B = commit(dir, "B");
const C = commit(dir, "C");
for (const [base, tag] of [[B, "v0.4.8"], [C, "v0.5.0"]]) {
  git(dir, ["checkout", "-q", "--detach", base]);
  commit(dir, `chore(release): ${tag}`);
  git(dir, ["tag", tag]);
}
git(dir, ["tag", "not-a-release"]);
git(dir, ["checkout", "-q", "main"]);

// The ancestry answer is the wrong one: this is the bug, kept as evidence.
assert.equal(git(dir, ["describe", "--tags", "--abbrev=0", "v0.5.0^"]), "v0.2.2");

for (const [tag, want] of [["v0.5.0", "v0.4.8"], ["v0.4.8", "v0.2.2"], ["v0.2.2", ""], ["v9.9.9", "v0.5.0"]]) {
  const r = previous(dir, tag);
  assert.equal(r.status, 0, `previous ${tag}: ${r.stderr}`);
  assert.equal(r.stdout.trim(), want, `the release before ${tag} is ${want || "(none)"}`);
}
const bad = previous(dir, "main");
assert.equal(bad.status, 1, "a non-vX.Y.Z argument is refused");

// Both release steps name the start tag.
const wf = fs.readFileSync(WORKFLOW, "utf8");
const creates = wf.split("gh release create").length - 1;
assert.equal(creates, 2, "release.yml has two `gh release create` steps");
assert.equal(wf.split("--notes-start-tag").length - 1, creates, "every `gh release create` passes --notes-start-tag");
assert.equal(wf.split("release-tags.mjs previous").length - 1, creates, "every start tag comes from release-tags.mjs previous");

console.log("release-notes-range-smoke: ok (previous tag by version order; both release steps pass --notes-start-tag)");

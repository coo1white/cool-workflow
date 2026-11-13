// release-notes-check-smoke — the check after every `gh release create`
// finds release notes that start before the previous release, fixes them
// with --fix, leaves right and hand-written notes alone, and fails when a
// fix does not stick. `gh` is a stub on PATH that keeps the releases in a
// JSON file; git is real, with tags on bump commits beside main.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const CHECK = path.join(pluginRoot, "scripts", "release-notes-check.mjs");
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

const GH_STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const db = process.env.GH_STUB_DB;
const s = JSON.parse(fs.readFileSync(db, "utf8"));
const a = process.argv.slice(2);
const save = () => fs.writeFileSync(db, JSON.stringify(s));
fs.appendFileSync(db + ".log", a.join(" ") + "\\n");
if (a[0] === "release" && a[1] === "list") { console.log(Object.keys(s.releases).join("\\n")); }
else if (a[0] === "release" && a[1] === "view") {
  if (!(a[2] in s.releases)) { console.error("release not found"); process.exit(1); }
  console.log(s.releases[a[2]]);
}
else if (a[0] === "release" && a[1] === "edit") {
  const notes = fs.readFileSync(a[a.indexOf("--notes-file") + 1], "utf8").trim();
  if (!s.ignoreEdits) s.releases[a[2]] = notes;
  save();
}
else if (a[0] === "api") {
  const f = (k) => a.find((x) => x.startsWith(k + "=")).split("=")[1];
  console.log("* a change\\n\\n**Full Changelog**: https://github.com/o/r/compare/" + f("previous_tag_name") + "..." + f("tag_name"));
}
else { console.error("stub gh: unexpected " + a.join(" ")); process.exit(2); }
`;

// main: A (v0.2.2) -> B -> C -> D; v0.4.7, v0.4.8 and v0.5.0 on bump commits
// beside main, the shape the release jobs make.
const dir = tmpDir("cw-notes-check-");
git(dir, ["init", "-q", "-b", "main"]);
for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"], ["tag.gpgSign", "false"]]) git(dir, ["config", k, v]);
commit(dir, "A");
git(dir, ["tag", "v0.2.2"]);
for (const tag of ["v0.4.7", "v0.4.8", "v0.5.0"]) {
  const base = commit(dir, `work for ${tag}`);
  git(dir, ["checkout", "-q", "--detach", base]);
  commit(dir, `chore(release): ${tag}`);
  git(dir, ["tag", tag]);
  git(dir, ["checkout", "-q", "main"]);
}
const bin = path.join(dir, ".bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "gh"), GH_STUB, { mode: 0o755 });
const db = path.join(dir, ".gh.json");
const cmp = (from, to) => `* x\n\n**Full Changelog**: https://github.com/o/r/compare/${from}...${to}`;
function seed(extra = {}) {
  fs.rmSync(`${db}.log`, { force: true });
  fs.writeFileSync(db, JSON.stringify({
    releases: {
      "v0.2.2": "First release, written by hand.",
      "v0.4.7": "Hand-written notes, no link.",
      "v0.4.8": cmp("v0.2.2", "v0.4.8"),
      "v0.5.0": cmp("v0.4.8", "v0.5.0")
    },
    ...extra
  }));
}
function check(...args) {
  const r = spawnSync(process.execPath, [CHECK, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_STUB_DB: db, GH_REPO: "o/r" }
  });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
}
const releases = () => JSON.parse(fs.readFileSync(db, "utf8")).releases;

// 1. Without --fix: the wrong range is named and fails; nothing is written.
seed();
let r = check("--all");
assert.equal(r.code, 1, r.text);
assert.match(r.text, /WRONG v0\.4\.8: starts at v0\.2\.2, not v0\.4\.7/);
assert.match(r.text, /ok   v0\.5\.0: starts at v0\.4\.8/);
assert.match(r.text, /ok   v0\.4\.7: hand-written notes/);
assert.match(r.text, /ok   v0\.2\.2: the first release/);
assert.doesNotMatch(fs.readFileSync(`${db}.log`, "utf8"), /release edit/, "no --fix, no edit");

// 2. --fix regenerates only the wrong one, from the previous release.
r = check("--all", "--fix");
assert.equal(r.code, 0, r.text);
assert.match(r.text, /v0\.4\.8: fixed: started at v0\.2\.2, now v0\.4\.7/);
assert.match(releases()["v0.4.8"], /compare\/v0\.4\.7\.\.\.v0\.4\.8/);
assert.equal(releases()["v0.4.7"], "Hand-written notes, no link.", "hand-written notes are left alone");
assert.equal((fs.readFileSync(`${db}.log`, "utf8").match(/release edit/g) || []).length, 1, "one edit, for the wrong release only");

// 3. One tag, as the release jobs call it.
seed();
assert.equal(check("--tag", "v0.5.0").code, 0);
assert.equal(check("--tag", "v0.4.8").code, 1);

// 4. A fix that does not stick fails the job.
seed({ ignoreEdits: true });
r = check("--tag", "v0.4.8", "--fix");
assert.equal(r.code, 1, r.text);
assert.match(r.text, /still starts at v0\.2\.2 after the fix/);

// 5. Bad usage is refused.
assert.equal(check().code, 1);
assert.equal(check("--tag", "main").code, 1);

// 6. Every `gh release create` in release.yml is followed by this check with --fix.
const wf = fs.readFileSync(WORKFLOW, "utf8");
const creates = wf.split("gh release create").length - 1;
assert.equal(creates, 2);
assert.equal(wf.split(/release-notes-check\.mjs --tag "\$\w+" --fix/).length - 1, creates, "each release step checks its notes with --fix");
assert.match(wf, /release-notes-check\.mjs --all --fix/, "a manual run checks and fixes every past release");

console.log("release-notes-check-smoke: ok (finds, fixes and re-reads a wrong range; leaves right and hand-written notes; fails when a fix does not stick)");

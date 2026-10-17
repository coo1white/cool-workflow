#!/usr/bin/env node
// release-notes-smoke — the "What changed" part of a GitHub Release body
// (scripts/release-notes.mjs, wired into scripts/release-flow.mjs).
//   1. The pure part: pull request titles from a fixed log, feat before fix,
//      at most six bullets, prefix and "(#N)" taken off, the none line, the
//      User Guide link and the compare link.
//   2. The real script (`release-flow.mjs --release`, gh stubbed, offline):
//      the part sits above "Provenance & audit"; with no previous tag the
//      body has no such part and stderr says so (fail closed, old body).
// Node + git only, isolated tmpdir. No network, no model.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPTS = path.resolve(import.meta.dirname, "..", "scripts");
const FLOW = path.join(SCRIPTS, "release-flow.mjs");
const NOTES = path.join(SCRIPTS, "release-notes.mjs");
assert.ok(fs.existsSync(NOTES), "scripts/release-notes.mjs must exist");
const { titlesFromLog, pickChanges, renderWhatChanged, MAX_BULLETS } = await import(NOTES);

const SLUG = { owner: "test-owner", repo: "test-repo" };
const rec = (subject, body = "") => `${subject}\x1f${body}\x1e`;

// ---- 1a. titles: a merge commit gives its body's first line; a plain commit its subject
{
  const log = [
    rec("Merge pull request #12 from o/feat-x", "feat(run): resume picks up a stopped run (#12)\n\nlong text"),
    rec("fix: report shows the right path (#11)"),
    rec("Merge pull request #10 from o/no-body", "")
  ].join("\n");
  assert.deepEqual(titlesFromLog(log), [
    "feat(run): resume picks up a stopped run (#12)",
    "fix: report shows the right path (#11)"
  ]);
}

// ---- 1b. feat before fix, prefixes and trailing "(...)" off, others dropped
{
  const { feat, fix } = pickChanges([
    "fix(release): the npm check asks the registry (#803)",
    "chore: bump version",
    "docs(backlog): park a row",
    "feat(esm): src/ become ES modules (step 5, D5)",
    "Feat!: doctor names the fix."
  ]);
  assert.deepEqual(feat, ["src/ become ES modules", "doctor names the fix"]);
  assert.deepEqual(fix, ["the npm check asks the registry"]);
  const text = renderWhatChanged({ version: "1.2.3", prevTag: "v1.2.2", slug: SLUG, titles: [
    "fix(release): the npm check asks the registry (#803)",
    "feat(esm): src/ become ES modules (step 5, D5)"
  ] });
  const lines = text.split("\n");
  assert.equal(lines[0], "### What changed");
  assert.equal(lines[2], "cool-workflow 1.2.3: 1 new feature and 1 fix since v1.2.2.");
  assert.deepEqual(lines.filter((l) => l.startsWith("- ")), ["- src/ become ES modules", "- the npm check asks the registry"]);
  assert.match(text, /\[User Guide\]\(https:\/\/github\.com\/test-owner\/test-repo\/wiki\/User-Guide\)/);
  assert.match(text, /\(https:\/\/github\.com\/test-owner\/test-repo\/compare\/v1\.2\.2\.\.\.v1\.2\.3\)\.$/);
}

// ---- 1c. at most six bullets; the rest are named on the compare line
{
  assert.equal(MAX_BULLETS, 6);
  const titles = [];
  for (let i = 1; i <= 5; i++) titles.push(`fix: fix ${i}`);
  for (let i = 1; i <= 4; i++) titles.push(`feat: feature ${i}`);
  const text = renderWhatChanged({ version: "1.2.3", prevTag: "v1.2.2", slug: SLUG, titles });
  const bullets = text.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 6, "never more than six bullets");
  assert.deepEqual(bullets.slice(0, 4), ["- feature 1", "- feature 2", "- feature 3", "- feature 4"], "features come first");
  assert.deepEqual(bullets.slice(4), ["- fix 1", "- fix 2"]);
  assert.match(text, /4 new features and 5 fixes since v1\.2\.2\./);
  assert.match(text, /\(3 more there\)\.$/);
  assert.ok(text.split("\n").length <= 20, "one page at most");
}

// ---- 1d. none: a plain line, not an empty list
{
  const text = renderWhatChanged({ version: "1.2.3", prevTag: "v1.2.2", slug: SLUG, titles: ["chore: tidy", "docs: words"] });
  assert.match(text, /^cool-workflow 1\.2\.3: no new features or fixes a user can see since v1\.2\.2; this release is upkeep\.$/m);
  assert.doesNotMatch(text, /^- /m, "no empty bullet list");
  assert.match(text, /compare\/v1\.2\.2\.\.\.v1\.2\.3/, "the compare link is still there");
}

// ---- 2. the real script: part above provenance; fail closed with no prev tag
function run(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
function commit(dir, file, msg) {
  fs.writeFileSync(path.join(dir, file), `${msg}\n`);
  run("git", ["add", "-A", "-f"], dir);
  run("git", ["commit", "-q", "-m", msg], dir);
}
function fixture(withPrevTag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-relnotes-"));
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@t"], ["config", "user.name", "t"],
    ["config", "commit.gpgsign", "false"], ["remote", "add", "origin", "https://github.com/test-owner/test-repo.git"]]) run("git", a, dir);
  commit(dir, "README.md", "init");
  if (withPrevTag) run("git", ["tag", "-a", "v9.9.8", "-m", "v9.9.8"], dir);
  run("git", ["checkout", "-q", "-b", "feat-x"], dir);
  commit(dir, "x.txt", "work on x");
  run("git", ["checkout", "-q", "main"], dir);
  run("git", ["merge", "-q", "--no-ff", "feat-x", "-m", "Merge pull request #7 from o/feat-x\n\nfeat(cli): cw doctor names the next step (#7)"], dir);
  commit(dir, "y.txt", "fix: report path is right (#8)");
  const contentSha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  fs.mkdirSync(path.join(dir, ".cw-release"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".cw-release", `review-${contentSha}.verdict`), `APPROVED ${contentSha}\nStub capability.\n`);
  commit(dir, "z.txt", "chore(release): record verdict");
  run("git", ["tag", "-a", "v9.9.9", "-m", "v9.9.9"], dir);
  const stub = path.join(dir, "gh-stub.mjs");
  fs.writeFileSync(stub, `#!/usr/bin/env node
import fs from "node:fs";
const a = process.argv.slice(2);
if (a[0] === "release" && a[1] === "view") process.exit(1);
if (a[0] === "release" && a[1] === "create") fs.writeFileSync(process.env.GH_STUB_NOTES_OUT, fs.readFileSync(a[a.indexOf("--notes-file") + 1]));
process.exit(0);
`);
  fs.chmodSync(stub, 0o755);
  const notesOut = path.join(dir, "notes.md");
  const r = run("node", [FLOW, "--release", "--version", "9.9.9"], dir,
    { ...process.env, CW_RELEASE_FLOW_GH_CMD: stub, GH_STUB_NOTES_OUT: notesOut });
  assert.equal(r.code, 0, `--release should succeed:\n${r.err}\n${r.out}`);
  return { notes: fs.readFileSync(notesOut, "utf8"), err: r.err };
}
{
  const { notes } = fixture(true);
  const what = notes.indexOf("### What changed");
  const prov = notes.indexOf("### Provenance & audit");
  assert.ok(what >= 0 && prov > what, `the "What changed" part sits above provenance:\n${notes}`);
  assert.ok(notes.indexOf("> Stub capability.") < what, "the reviewer's line stays first");
  assert.match(notes, /cool-workflow 9\.9\.9: 1 new feature and 1 fix since v9\.9\.8\./);
  assert.match(notes, /^- cw doctor names the next step\n- report path is right$/m);
  assert.doesNotMatch(notes, /record verdict|work on x/, "only feat and fix titles");
}
{
  const { notes, err } = fixture(false);
  assert.doesNotMatch(notes, /What changed/, "no previous tag: no made-up change list");
  assert.ok(notes.startsWith("> Stub capability.\n\n---\n\n### Provenance & audit"), `old body, unchanged:\n${notes}`);
  assert.match(err, /no previous release tag before v9\.9\.9 — the notes have no "What changed" part/);
}

process.stdout.write("release-notes-smoke: ok\n");

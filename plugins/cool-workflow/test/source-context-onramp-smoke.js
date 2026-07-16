#!/usr/bin/env node
"use strict";

// source-context-onramp-smoke: the two on-ramp blockers that forced a new user
// to hand-author boilerplate when pointing the exporter at a foreign repo.
//   B3: `--max-lines N` overrides a profile's maxLines guard (both directions),
//       so a mid-size repo does not require editing the profile JSON.
//   B4: `--profile-file custom.json` alone (no `--profile`) uses that file's sole
//       profile instead of dying "unknown profile: core"; a file with several
//       profiles and no `--profile` dies with a message listing the choices.
// Covered on both surfaces: source-context.js and the architecture-review-fast.js
// wrapper.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const sc = path.join(pluginRoot, "scripts", "source-context.js");
const wrapper = path.join(pluginRoot, "scripts", "architecture-review-fast.js");
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-onramp-")));

function git(args) {
  const r = cp.spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function scRun(args) {
  return cp.spawnSync(process.execPath, [sc, ...args], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
}
function wrapRun(args) {
  return cp.spawnSync(process.execPath, [wrapper, ...args], { cwd: pluginRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
}

// A repo with 6 lines of includable text across two files.
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src", "a.md"), "l1\nl2\nl3\n", "utf8");
fs.writeFileSync(path.join(repo, "src", "b.md"), "l1\nl2\nl3\n", "utf8");
git(["init"]);
git(["add", "-A"]);
git(["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);

// A single-profile file whose profile is NOT named "core", with a tiny maxLines.
const single = path.join(repo, "single.json");
fs.writeFileSync(single, JSON.stringify({
  schemaVersion: 1,
  profiles: { onlyone: { description: "sole profile", maxLines: 2, include: ["src/**"], exclude: [] } }
}), "utf8");

// A multi-profile file (no obvious default).
const multi = path.join(repo, "multi.json");
fs.writeFileSync(multi, JSON.stringify({
  schemaVersion: 1,
  profiles: {
    first: { description: "a", maxLines: 1000, include: ["src/**"], exclude: [] },
    second: { description: "b", maxLines: 1000, include: ["src/a.md"], exclude: [] }
  }
}), "utf8");

// ---------- B4 (source-context): --profile-file alone uses the sole profile ----------
{
  const r = scRun(["manifest", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD"]);
  assert.equal(r.status, 0, `--profile-file alone must use the file's sole profile, not die on "core"\n${r.stderr}`);
  const recs = r.stdout.trim().split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(recs.some((x) => x.path === "src/a.md" && x.included === true), "the sole profile's includes apply");
}

// ---------- B4 (source-context): multi-profile file with no --profile dies helpfully ----------
{
  const r = scRun(["manifest", "--profile-file", multi, "--repo-root", repo, "--ref", "HEAD"]);
  assert.equal(r.status, 1, "a multi-profile file with no --profile must fail closed");
  assert.match(r.stderr, /first/, "the error names the available profiles");
  assert.match(r.stderr, /second/, "the error names the available profiles");
  assert.match(r.stderr, /--profile/, "the error tells the user to pass --profile");
}

// ---------- B4 still works when --profile IS given ----------
{
  const r = scRun(["manifest", "--profile", "second", "--profile-file", multi, "--repo-root", repo, "--ref", "HEAD"]);
  assert.equal(r.status, 0, "explicit --profile still selects a named profile");
}

// ---------- B3 (source-context): profile maxLines guard fires; --max-lines overrides ----------
{
  // 6 exported lines > profile maxLines 2 -> export dies without an override.
  const capped = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD"]);
  assert.equal(capped.status, 1, "export over the profile's maxLines must die by default");
  assert.match(capped.stderr, /maxLines/, "the cap error names maxLines");

  // --max-lines raises the cap -> succeeds.
  const raised = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD", "--max-lines", "1000"]);
  assert.equal(raised.status, 0, `--max-lines must override the profile guard\n${raised.stderr}`);
  assert.equal(raised.stdout.trim().split(/\n/).filter(Boolean).length, 2, "both included files export under the raised cap");

  // --max-lines can also lower the cap (proves it overrides, not just raises).
  const lowered = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD", "--max-lines", "1"]);
  assert.equal(lowered.status, 1, "--max-lines below the export size must die");

  // --max-lines rejects bad values: negative, whitespace-only (must NOT coerce
  // to 0 = no cap), hex, and exponent forms.
  for (const badVal of ["-3", "   ", "0x10", "1e21", "3.5"]) {
    const bad = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD", "--max-lines", badVal]);
    assert.equal(bad.status, 1, `--max-lines ${JSON.stringify(badVal)} must be refused, not fail open`);
    assert.match(bad.stderr, /--max-lines/, "the refusal names the flag");
  }

  // The cap must survive a warm cache: a run with a loose cap warms the cache,
  // then a run with a TIGHTER cap must still die (fail closed), not serve the
  // cached over-cap export. Regression for the --max-lines-not-in-cache-key hole.
  const cache = path.join(repo, ".cache-cap");
  const warm = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD", "--max-lines", "1000", "--cache-dir", cache]);
  assert.equal(warm.status, 0, `loose-cap cached export must succeed\n${warm.stderr}`);
  const tight = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD", "--max-lines", "1", "--cache-dir", cache]);
  assert.equal(tight.status, 1, "a tighter --max-lines must still die on a warm cache (cap is in the cache key)");
  assert.match(tight.stderr, /maxLines/, "the warm-cache cap error names maxLines");
  // Same cap re-uses the cache (byte-identical), proving keying-on-cap still dedups.
  const warm2 = scRun(["export", "--profile-file", single, "--repo-root", repo, "--ref", "HEAD", "--max-lines", "1000", "--cache-dir", cache]);
  assert.equal(warm2.stdout, warm.stdout, "same --max-lines re-uses the cache byte-identically");
}

// ---------- Wrapper: --profile-file alone (B4) + --max-lines (B3) on --preview ----------
{
  const r = wrapRun(["--repo", repo, "--question", "on-ramp", "--profile-file", single, "--max-lines", "1000", "--preview"]);
  assert.equal(r.status, 0, `wrapper: --profile-file alone + --max-lines must build context without hand-editing the profile\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sourceContext.profile, "onlyone", "the wrapper resolves the file's sole profile name");
}

// ---------- Wrapper: multi-profile file with no --profile fails helpfully ----------
{
  const r = wrapRun(["--repo", repo, "--question", "on-ramp", "--profile-file", multi, "--preview"]);
  assert.equal(r.status, 1, "wrapper: multi-profile file with no --profile must fail closed");
  assert.match(r.stderr, /first.*second|second.*first/s, "wrapper error lists the available profile ids");
  assert.match(r.stderr, /--profile /, "wrapper error tells the user to pass --profile <name>");
}

fs.rmSync(repo, { recursive: true, force: true });
process.stdout.write("source-context-onramp-smoke: ok\n");

"use strict";
// source-context-profile-smoke — proves the repo-local AI context profile is
// opt-in, JSONL-clean, and faithful to the remembered include/exclude policy.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "source-context.js");
const profilePath = path.join(pluginRoot, "manifest", "source-context-profiles.json");

const expectedInclude = [
  "plugins/cool-workflow/src/**",
  "plugins/cool-workflow/apps/**",
  "plugins/cool-workflow/package.json",
  "plugins/cool-workflow/tsconfig.json",
  "plugins/cool-workflow/scripts/cw.js",
  "plugins/cool-workflow/scripts/mcp-server.js",
  "plugins/cool-workflow/scripts/agents/**"
];
const expectedExclude = [
  "plugins/cool-workflow/dist/**",
  "plugins/cool-workflow/test/**",
  "plugins/cool-workflow/docs/**",
  "docs/assets/**",
  ".cw-release/**",
  "CHANGELOG.md",
  "ITERATION_LOG.md"
];

const profileFile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
const core = profileFile.profiles.core;
assert.deepEqual(core.include, expectedInclude, "core include policy must match project memory");
assert.deepEqual(core.exclude, expectedExclude, "core exclude policy must match project memory");
assert.equal(core.maxLines, 50000, "core profile keeps a 50k-line guard");
for (const name of ["runtime", "mcp", "workflow-apps", "release", "agent-wrappers"]) {
  assert.ok(profileFile.profiles[name], `${name} subprofile is declared`);
  assert.ok(profileFile.profiles[name].maxLines < core.maxLines, `${name} subprofile has a tighter line guard than core`);
}

function run(args) {
  const result = cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64
  });
  assert.equal(result.status, 0, `${args.join(" ")} failed\nSTDERR:\n${result.stderr}`);
  assert.equal(result.stderr, "", `${args.join(" ")} must keep diagnostics off stderr on success`);
  return result.stdout.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function runRaw(args, options = {}) {
  return cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    ...options
  });
}

const manifest = run(["manifest", "--profile", "core", "--ref", "HEAD"]);
assert.ok(manifest.length > 100, "manifest must cover the tracked repository");

const byPath = new Map(manifest.map((record) => [record.path, record]));
assert.equal(byPath.get("plugins/cool-workflow/src/cli.ts").included, true);
assert.match(byPath.get("plugins/cool-workflow/src/cli.ts").reason, /^included:/);
assert.equal(byPath.get("plugins/cool-workflow/dist/cli.js").included, false);
assert.match(byPath.get("plugins/cool-workflow/dist/cli.js").reason, /^excluded:/);
assert.equal(byPath.get("plugins/cool-workflow/test/run-all.js").included, false);
assert.equal(byPath.get("plugins/cool-workflow/docs/index.md").included, false);
assert.equal(byPath.get("CHANGELOG.md").included, false);
assert.equal(byPath.get("ITERATION_LOG.md").included, false);

for (const record of manifest) {
  assert.match(record.sha256, /^[0-9a-f]{64}$/, `record has sha256: ${record.path}`);
  assert.equal(typeof record.bytes, "number", `record has byte count: ${record.path}`);
}

const exported = run(["export", "--profile", "core", "--ref", "HEAD"]);
assert.ok(exported.length > 50, "export must include runtime files");
assert.ok(exported.every((record) => record.included === true), "export contains only included files");
assert.ok(exported.every((record) => typeof record.content === "string"), "export records carry content");
assert.ok(!exported.some((record) => record.path.startsWith("plugins/cool-workflow/dist/")), "export excludes dist");
assert.ok(!exported.some((record) => record.path.startsWith("plugins/cool-workflow/test/")), "export excludes tests");
assert.ok(!exported.some((record) => record.path.startsWith("plugins/cool-workflow/docs/")), "export excludes docs");

const totalLines = exported.reduce((sum, record) => sum + record.lines, 0);
assert.ok(totalLines > 30000, `core export should be substantial, got ${totalLines}`);
assert.ok(totalLines <= core.maxLines, `core export must stay under ${core.maxLines}, got ${totalLines}`);

const subprofileExpectations = {
  runtime: {
    includes: ["plugins/cool-workflow/src/drive.ts"],
    excludes: ["plugins/cool-workflow/apps/architecture-review-fast/workflow.js", "plugins/cool-workflow/scripts/cw.js"]
  },
  mcp: {
    includes: ["plugins/cool-workflow/src/mcp-server.ts", "plugins/cool-workflow/scripts/mcp-server.js"],
    excludes: ["plugins/cool-workflow/apps/architecture-review-fast/workflow.js"]
  },
  "workflow-apps": {
    includes: ["plugins/cool-workflow/apps/architecture-review-fast/workflow.js", "plugins/cool-workflow/src/workflow-app-framework.ts"],
    excludes: ["plugins/cool-workflow/src/mcp-server.ts"]
  },
  release: {
    includes: ["plugins/cool-workflow/scripts/release-flow.js", "plugins/cool-workflow/scripts/version-sync-check.js"],
    excludes: ["plugins/cool-workflow/src/drive.ts"]
  },
  "agent-wrappers": {
    includes: ["plugins/cool-workflow/scripts/agents/claude-p-agent.js", "plugins/cool-workflow/src/agent-config.ts"],
    excludes: ["plugins/cool-workflow/apps/architecture-review-fast/workflow.js"]
  }
};

for (const [profile, expectation] of Object.entries(subprofileExpectations)) {
  const records = run(["export", "--profile", profile, "--ref", "HEAD"]);
  const paths = new Set(records.map((record) => record.path));
  const lines = records.reduce((sum, record) => sum + record.lines, 0);
  assert.ok(records.length > 0, `${profile} exports records`);
  assert.ok(lines <= profileFile.profiles[profile].maxLines, `${profile} export stays under guard`);
  assert.ok(lines < totalLines, `${profile} is slimmer than core`);
  for (const included of expectation.includes) assert.ok(paths.has(included), `${profile} includes ${included}`);
  for (const excluded of expectation.excludes) assert.ok(!paths.has(excluded), `${profile} excludes ${excluded}`);
}

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-cache-"));
const cachedFirst = runRaw(["export", "--profile", "core", "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.equal(cachedFirst.status, 0, `cached export failed\nSTDERR:\n${cachedFirst.stderr}`);
assert.equal(cachedFirst.stderr, "", "cached export must keep diagnostics off stderr on success");
assert.equal(cachedFirst.stdout, exported.map((record) => `${JSON.stringify(record)}\n`).join(""), "cached export preserves JSONL bytes");
const cacheFiles = fs.readdirSync(cacheDir).filter((file) => file.endsWith(".jsonl"));
assert.equal(cacheFiles.length, 1, "cache-dir stores one profile/ref/digest JSONL file");

const cachedSecond = runRaw(["export", "--profile", "core", "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.equal(cachedSecond.status, 0, `cached second export failed\nSTDERR:\n${cachedSecond.stderr}`);
assert.equal(cachedSecond.stderr, "", "cache hit is silent on stderr");
assert.equal(cachedSecond.stdout, cachedFirst.stdout, "cache hit returns the same JSONL bytes");

const tamperedRecord = JSON.parse(cachedFirst.stdout.trim().split(/\n/)[0]);
tamperedRecord.content = `${tamperedRecord.content}\ncache tamper\n`;
fs.writeFileSync(path.join(cacheDir, cacheFiles[0]), `${JSON.stringify(tamperedRecord)}\n`, "utf8");
const tamperedHit = runRaw(["export", "--profile", "core", "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.notEqual(tamperedHit.status, 0, "syntactically valid cache with mismatched content digest must fail closed");
assert.match(tamperedHit.stderr, /content digest mismatch/, "tampered cache names the digest refusal");

fs.writeFileSync(path.join(cacheDir, cacheFiles[0]), "{\"not\":\"valid\"}\n", "utf8");
const corruptHit = runRaw(["export", "--profile", "core", "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.notEqual(corruptHit.status, 0, "corrupt cache must fail closed");
assert.match(corruptHit.stderr, /invalid source context cache/, "corrupt cache names the refusal");

const diffRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-diff-"));
fs.writeFileSync(path.join(diffRepo, "a.txt"), "one\n", "utf8");
fs.writeFileSync(path.join(diffRepo, "b.txt"), "remove me\n", "utf8");
fs.mkdirSync(path.join(diffRepo, "docs"), { recursive: true });
fs.writeFileSync(path.join(diffRepo, "docs", "c.txt"), "doc\n", "utf8");
git(diffRepo, ["init"]);
git(diffRepo, ["add", "."]);
git(diffRepo, ["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "base"]);
const baseRef = git(diffRepo, ["rev-parse", "HEAD"]).trim();
fs.writeFileSync(path.join(diffRepo, "a.txt"), "one\ntwo\n", "utf8");
fs.writeFileSync(path.join(diffRepo, "d.txt"), "new\n", "utf8");
fs.writeFileSync(path.join(diffRepo, "docs", "c.txt"), "doc\nchanged\n", "utf8");
fs.rmSync(path.join(diffRepo, "b.txt"));
git(diffRepo, ["add", "-A"]);
git(diffRepo, ["-c", "user.name=CW", "-c", "user.email=cw@example.invalid", "commit", "-m", "change"]);

const diffProfileFile = path.join(diffRepo, "profiles.json");
fs.writeFileSync(
  diffProfileFile,
  JSON.stringify({
    schemaVersion: 1,
    profiles: {
      smoke: {
        description: "Diff-aware smoke profile.",
        maxLines: 20,
        include: ["a.txt", "d.txt", "docs/c.txt"],
        exclude: ["docs/**"]
      }
    }
  }, null, 2),
  "utf8"
);
const diffManifest = run([
  "manifest",
  "--profile", "smoke",
  "--profile-file", diffProfileFile,
  "--repo-root", diffRepo,
  "--changed-from", baseRef,
  "--ref", "HEAD"
]);
assert.deepEqual(diffManifest.map((record) => record.path).sort(), ["a.txt", "d.txt", "docs/c.txt"], "changed manifest includes only current changed paths");
assert.ok(diffManifest.every((record) => record.changedFrom === baseRef), "changed manifest records the resolved base ref");
assert.equal(diffManifest.find((record) => record.path === "docs/c.txt").included, false, "changed manifest still applies excludes");

const diffExport = run([
  "export",
  "--profile", "smoke",
  "--profile-file", diffProfileFile,
  "--repo-root", diffRepo,
  "--changed-from", baseRef,
  "--ref", "HEAD"
]);
assert.deepEqual(diffExport.map((record) => record.path).sort(), ["a.txt", "d.txt"], "changed export includes only changed included files");
assert.ok(diffExport.every((record) => record.changedFrom === baseRef), "changed export records the resolved base ref");

const diffCache = fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-context-diff-cache-"));
const fullCached = runRaw([
  "export",
  "--profile", "smoke",
  "--profile-file", diffProfileFile,
  "--repo-root", diffRepo,
  "--ref", "HEAD",
  "--cache-dir", diffCache
]);
assert.equal(fullCached.status, 0, `full diff repo export failed\nSTDERR:\n${fullCached.stderr}`);
const changedCached = runRaw([
  "export",
  "--profile", "smoke",
  "--profile-file", diffProfileFile,
  "--repo-root", diffRepo,
  "--changed-from", baseRef,
  "--ref", "HEAD",
  "--cache-dir", diffCache
]);
assert.equal(changedCached.status, 0, `changed diff repo export failed\nSTDERR:\n${changedCached.stderr}`);
assert.notEqual(changedCached.stdout, fullCached.stdout, "changed export cache is distinct from full export cache");
assert.equal(fs.readdirSync(diffCache).filter((file) => file.endsWith(".jsonl")).length, 2, "cache-dir stores separate full and changed exports");

for (const file of ["Codex.md", "PROJECT_MEMORY.md"]) {
  const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
  assert.ok(text.includes("source-context") || text.includes("core"), `${file} records the context policy`);
}

for (const skill of ["ci-triage", "pr-review", "design-qa", "deploy-check"]) {
  const text = fs.readFileSync(path.join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
  const templateMarker = ["TO", "DO"].join("");
  assert.ok(!text.includes(templateMarker), `${skill} skill must not contain template markers`);
  assert.match(text, new RegExp(`name: ${skill}`), `${skill} skill has matching frontmatter`);
}

for (const workflow of ["ci-triage", "pr-review", "design-qa", "deploy-check"]) {
  const evalFile = path.join(repoRoot, "eval", `${workflow}.jsonl`);
  const lines = fs.readFileSync(evalFile, "utf8").trim().split(/\n/);
  assert.ok(lines.length >= 1, `${workflow} eval has at least one case`);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.equal(parsed.workflow, workflow);
    assert.ok(parsed.expected, `${workflow} eval case has expected criteria`);
  }
}

fs.rmSync(diffRepo, { recursive: true, force: true });

process.stdout.write(`source-context-profile-smoke: ok (${exported.length} records, ${totalLines} exported lines)\n`);

function git(cwd, argv) {
  return cp.execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

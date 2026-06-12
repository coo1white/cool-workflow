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

fs.writeFileSync(path.join(cacheDir, cacheFiles[0]), "{\"not\":\"valid\"}\n", "utf8");
const corruptHit = runRaw(["export", "--profile", "core", "--ref", "HEAD", "--cache-dir", cacheDir]);
assert.notEqual(corruptHit.status, 0, "corrupt cache must fail closed");
assert.match(corruptHit.stderr, /invalid source context cache/, "corrupt cache names the refusal");

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

process.stdout.write(`source-context-profile-smoke: ok (${exported.length} records, ${totalLines} exported lines)\n`);

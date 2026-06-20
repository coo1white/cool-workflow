#!/usr/bin/env node
"use strict";

// release-flow-smoke — exercises scripts/release-flow.js, the portable,
// vendor-neutral release orchestrator. We run the REAL script against throwaway
// git fixtures with:
//   - the deterministic gate stubbed out (CW_RELEASE_FLOW_GATE_CMD=true) so we
//     test the ORCHESTRATION layer, not the full build/test suite (that is
//     covered by release-gate-smoke.js) and avoid recursing into npm test;
//   - the reviewer delegated to a STUB agent (CW_AGENT_COMMAND) that writes a
//     chosen verdict — proving the delegate→verdict→verify path works for ANY
//     configured agent, and fails CLOSED on REJECTED / missing / unconfigured.
//
// Every assertion fails if the orchestration logic is reverted. Portable:
// node + git only, isolated tmpdir. No real model is ever spawned.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FLOW = path.resolve(__dirname, "..", "scripts", "release-flow.js");
assert.ok(fs.existsSync(FLOW), "release-flow.js must exist");

// ---- red line (static): the orchestrator spawns shell:false and embeds no
// model SDK / API key. Mirrors quickstart-smoke.js's guard.
{
  const src = fs.readFileSync(FLOW, "utf8");
  assert.match(src, /shell:\s*false/, "agent delegation must spawn shell:false (red line)");
  for (const sdk of ["@anthropic-ai", "openai", "@google/generative-ai", "ollama", "cohere", "mistralai"]) {
    assert.ok(!new RegExp(`require\\(["'][^"']*${sdk}`).test(src), `release-flow must not import a model SDK: ${sdk}`);
  }
  assert.ok(!/api[._-]?key/i.test(src.replace(/CW_AGENT[A-Z_]*/g, "")), "release-flow must not handle an API key");
}

let caseId = 0;
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-flow-${caseId++}-`));
  run("git", ["init", "-q", "-b", "work"], dir);
  run("git", ["config", "user.email", "t@t"], dir);
  run("git", ["config", "user.name", "t"], dir);
  run("git", ["config", "commit.gpgsign", "false"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  return dir;
}
function run(bin, args, cwd, env) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", env: env || process.env });
  return { code: r.status, out: (r.stdout || ""), err: (r.stderr || "") };
}

// A stub "agent": node script that writes a chosen verdict to {{result}}.
// verdict arg: APPROVED | REJECTED | MIXED | NONE (writes nothing).
function writeStub(dir) {
  const stub = path.join(dir, "stub-agent.js");
  fs.writeFileSync(stub, `
const fs = require("node:fs");
const resultPath = process.argv[2];
const kind = process.argv[3];
if (kind === "APPROVED") fs.writeFileSync(resultPath, "APPROVED " + (process.env.STUB_SHA||"sha") + "\\nstub: capability sentence.\\n");
else if (kind === "REJECTED") fs.writeFileSync(resultPath, "REJECTED\\n1. stub gate failure.\\n");
else if (kind === "MIXED") fs.writeFileSync(resultPath, "REJECTED\\n1. hard failure\\nAPPROVED wrongsha\\nshould not pass\\n");
// NONE: write nothing (simulate an agent that produced no verdict)
process.exit(0);
`);
  return stub;
}

function runFlow(dir, { agentCmd } = {}) {
  // Self-hermetic env, correct whether this smoke runs bare (`node
  // test/release-flow-smoke.js`) or under run-all.js's sandbox:
  //   - CW_NO_AUTO_AGENT=1 stops resolveAgentConfig() from auto-detecting a real
  //     agent CLI on PATH (claude/codex/gemini). Without it, the "no agent
  //     configured" case (Case 4) would silently resolve builtin:<detected> and
  //     spawn a real model instead of failing closed.
  //   - CW_HOME/XDG_STATE_HOME point at a throwaway dir under the fixture so a
  //     durable ~/.local/state/.../agent-config.json on the host can't configure
  //     an agent either. The agent layers we want are flags/env ONLY.
  const home = path.join(dir, ".cw-home");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GATE_CMD: "true",
    STUB_SHA: run("git", ["rev-parse", "HEAD"], dir).out.trim(),
    CW_NO_AUTO_AGENT: "1",
    CW_HOME: home,
    XDG_STATE_HOME: home
  };
  delete env.CW_AGENT_COMMAND;
  delete env.CW_AGENT_ENDPOINT;
  if (agentCmd !== undefined) env.CW_AGENT_COMMAND = agentCmd;
  return run("node", [FLOW, "--check"], dir, env);
}

// ---- Case 1: stub APPROVES → flow succeeds, verdict written ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} APPROVED` });
  assert.equal(r.code, 0, `APPROVED stub should pass:\n${r.err}\n${r.out}`);
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  const verdict = path.join(dir, ".cw-release", `review-${sha}.verdict`);
  assert.ok(fs.existsSync(verdict), "verdict file must be written");
  assert.match(fs.readFileSync(verdict, "utf8"), /^APPROVED /, "verdict must be APPROVED");
  assert.match(r.out, /"verdict": "APPROVED"/, "summary should report APPROVED");
}

// ---- Case 2: stub REJECTS → fail closed ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} REJECTED` });
  assert.equal(r.code, 1, "REJECTED verdict must fail the flow");
  assert.match(r.err, /not APPROVED|blocked/i, "should explain the block");
}

// ---- Case 2b: APPROVED later in a rejected verdict does NOT pass ------------
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} MIXED` });
  assert.equal(r.code, 1, "APPROVED must be the first line for THIS HEAD, not a later line");
  assert.match(r.err, /first line|APPROVED|blocked/i, "should explain strict verdict parsing");
}

// ---- Case 3: stub writes nothing → fail closed (missing verdict) ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} NONE` });
  assert.equal(r.code, 1, "missing verdict must fail the flow");
  assert.match(r.err, /no verdict|fail closed/i, "should explain the missing verdict");
}

// ---- Case 3b: stdout-only APPROVED agent (v0.1.88 — verdict-from-stdout) ----
// A headless agent that CANNOT write files prints APPROVED to stdout.
// The flow captures it and persists the verdict file itself.
{
  const dir = fixture();
  const stub = path.join(dir, "stdout-stub.js");
  fs.writeFileSync(stub, `process.stdout.write("APPROVED " + (process.env.STUB_SHA||"sha") + "\\nstdout: capability sentence.\\n"); process.exit(0);\n`);
  const r = runFlow(dir, { agentCmd: `node ${stub}` });
  assert.equal(r.code, 0, `stdout-only APPROVED stub should pass:\n${r.err}\n${r.out}`);
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  const verdict = path.join(dir, ".cw-release", `review-${sha}.verdict`);
  assert.ok(fs.existsSync(verdict), "verdict file must be written from stdout capture");
  assert.match(fs.readFileSync(verdict, "utf8"), /^APPROVED /, "captured verdict must be APPROVED");
  assert.match(r.out, /"verdict": "APPROVED"/, "summary should report APPROVED for stdout capture");
}

// ---- Case 3c: stdout-only REJECTED agent → fail closed ----
{
  const dir = fixture();
  const stub = path.join(dir, "stdout-reject-stub.js");
  fs.writeFileSync(stub, 'process.stdout.write("REJECTED\\n1. gate failure from stdout.\\n"); process.exit(0);\n');
  const r = runFlow(dir, { agentCmd: `node ${stub}` });
  assert.equal(r.code, 1, "stdout-only REJECTED must fail the flow");
  assert.match(r.err, /not APPROVED|blocked/i, "should explain the block from stdout capture");
}

// ---- Case 4: no agent configured → fail closed with guidance ----
{
  const dir = fixture();
  const r = runFlow(dir, { agentCmd: undefined });
  assert.equal(r.code, 1, "unconfigured agent must fail closed");
  assert.match(r.err, /no reviewer agent configured|CW_AGENT_COMMAND/, "should tell the operator how to configure");
}

// ---- Case 5: a failing gate stops the flow before any review ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const env = { ...process.env, CW_RELEASE_FLOW_GATE_CMD: "false", CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED` };
  const r = run("node", [FLOW, "--check"], dir, env);
  assert.equal(r.code, 1, "a red gate must stop the flow");
  assert.match(r.err, /gate FAILED/i, "should name the gate failure");
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  assert.ok(!fs.existsSync(path.join(dir, ".cw-release", `review-${sha}.verdict`)), "no verdict before a green gate");
}

// ---- GitHub Release finishing step (--release backfill mode) ---------------
// All offline: CW_RELEASE_FLOW_GH_CMD swaps `gh` for a node stub that records its
// argv, simulates "release view" via a sentinel, and captures the --notes-file
// body. No real gh / network is ever touched.
function writeGhStub(dir) {
  const stub = path.join(dir, "gh-stub.js");
  fs.writeFileSync(stub, `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
if (process.env.GH_STUB_REC) fs.appendFileSync(process.env.GH_STUB_REC, a.join(" ") + "\\n");
if (a[0] === "--version") { process.stdout.write("gh stub 0.0.0\\n"); process.exit(0); }
if (a[0] === "auth" && a[1] === "status") process.exit(process.env.GH_STUB_UNAUTH ? 1 : 0);
if (a[0] === "release" && a[1] === "view") process.exit(fs.existsSync(process.env.GH_STUB_SENTINEL) ? 0 : 1);
if (a[0] === "release" && a[1] === "create") {
  if (process.env.GH_STUB_CREATE_FAIL) { process.stderr.write("gh: create failed\\n"); process.exit(1); }
  const i = a.indexOf("--notes-file");
  if (i >= 0 && process.env.GH_STUB_NOTES_OUT) fs.writeFileSync(process.env.GH_STUB_NOTES_OUT, fs.readFileSync(a[i + 1]));
  fs.writeFileSync(process.env.GH_STUB_SENTINEL, "1");
  process.exit(0);
}
process.exit(0);
`);
  fs.chmodSync(stub, 0o755);
  return stub;
}

// Fixture with a prior tag (v9.9.8), a CHANGELOG, a content commit, and a verdict
// commit tagged v9.9.9 — so the verdict lives at the tag's HEAD~1 (the real cut
// shape) and prevTagOf/changelogSection/verdictForTag all resolve.
function releaseFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-rel-${caseId++}-`));
  run("git", ["init", "-q", "-b", "work"], dir);
  run("git", ["config", "user.email", "t@t"], dir);
  run("git", ["config", "user.name", "t"], dir);
  run("git", ["config", "commit.gpgsign", "false"], dir);
  run("git", ["remote", "add", "origin", "https://github.com/test-owner/test-repo.git"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  run("git", ["tag", "-a", "v9.9.8", "-m", "v9.9.8"], dir);
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## 9.9.9\n\nTest release body line.\n\n- bullet one\n- bullet two\n\n## 9.9.8\n\nold.\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "content"], dir);
  const contentSha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  fs.mkdirSync(path.join(dir, ".cw-release"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".cw-release", `review-${contentSha}.verdict`),
    `APPROVED ${contentSha}\nStub capability: resume + verify.\n`);
  run("git", ["add", "-A", "-f"], dir);
  run("git", ["commit", "-q", "-m", "record verdict"], dir);
  run("git", ["tag", "-a", "v9.9.9", "-m", "v9.9.9"], dir);
  return { dir, contentSha };
}

// ---- Case 6: --release creates the Release; notes carry capability + links ----
{
  const { dir, contentSha } = releaseFixture();
  const stub = writeGhStub(dir);
  const rec = path.join(dir, "gh-rec.txt");
  const notesOut = path.join(dir, "captured-notes.md");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: rec,
    GH_STUB_SENTINEL: path.join(dir, "gh-sentinel"),
    GH_STUB_NOTES_OUT: notesOut
  };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, env);
  assert.equal(r.code, 0, `--release should succeed:\n${r.err}\n${r.out}`);
  assert.match(r.out, /"mode": "release"/, "summary reports release mode");
  const recTxt = fs.readFileSync(rec, "utf8");
  assert.match(recTxt, /release create v9\.9\.9 --title v9\.9\.9 --notes-file /, "gh release create invoked with notes file");
  const notes = fs.readFileSync(notesOut, "utf8");
  assert.match(notes, /^> Stub capability: resume \+ verify\./m, "notes lead with the verdict capability");
  assert.match(notes, /Test release body line/, "notes embed the CHANGELOG section body");
  assert.match(notes, /bullet one/, "notes embed the CHANGELOG bullets");
  assert.match(notes, new RegExp(`github\\.com/test-owner/test-repo/commit/${contentSha}`), "notes link the reviewed commit");
  assert.match(notes, /blob\/v9\.9\.9\/\.cw-release\/review-/, "notes link the committed verdict at the tag");
  assert.match(notes, /compare\/v9\.9\.8\.\.\.v9\.9\.9/, "notes link the full diff against the prior tag");
  assert.match(notes, /npmjs\.com\/package\/cool-workflow\/v\/9\.9\.9/, "notes link the provenance-attested npm version");
}

// ---- Case 7: idempotent — a second --release skips, does not re-create ----
{
  const { dir } = releaseFixture();
  const stub = writeGhStub(dir);
  const rec = path.join(dir, "gh-rec.txt");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: rec,
    GH_STUB_SENTINEL: path.join(dir, "gh-sentinel"),
    GH_STUB_NOTES_OUT: path.join(dir, "n.md")
  };
  const r1 = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, env);
  assert.equal(r1.code, 0, "first --release creates");
  const r2 = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, env);
  assert.equal(r2.code, 0, "second --release is a clean skip");
  assert.match(r2.out, /already exists — skipping/i, "second run reports idempotent skip");
  const creates = (fs.readFileSync(rec, "utf8").match(/release create /g) || []).length;
  assert.equal(creates, 1, "gh release create runs exactly once across two invocations");
}

// ---- Case 8: gh absent → --release fails closed with guidance (required) ----
{
  const { dir } = releaseFixture();
  const env = { ...process.env, CW_RELEASE_FLOW_GH_CMD: path.join(dir, "does-not-exist-gh") };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, env);
  assert.equal(r.code, 1, "--release must fail when gh is unavailable");
  assert.match(r.err, /gh CLI not available/i, "should tell the operator gh is needed");
}

// ---- Case 9: --dry-run plans the create without invoking it ----
{
  const { dir } = releaseFixture();
  const stub = writeGhStub(dir);
  const rec = path.join(dir, "gh-rec.txt");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: rec,
    GH_STUB_SENTINEL: path.join(dir, "gh-sentinel"),
    GH_STUB_NOTES_OUT: path.join(dir, "n.md")
  };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9", "--dry-run"], dir, env);
  assert.equal(r.code, 0, "dry-run release should succeed");
  assert.match(r.out, /\[dry-run\] would: gh release create v9\.9\.9/, "dry-run prints the planned create");
  assert.ok(!/release create /.test(fs.readFileSync(rec, "utf8")), "dry-run must NOT actually create the Release");
}

// ---- Case 10: --soft + gh create fails → skip-not-fail (exit 0) -------------
// Covers the required:false create-failure branch that the --cut --push finishing
// step depends on (a Release failure must never fail a cut).
{
  const { dir } = releaseFixture();
  const stub = writeGhStub(dir);
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: path.join(dir, "rec.txt"),
    GH_STUB_SENTINEL: path.join(dir, "sentinel"),
    GH_STUB_CREATE_FAIL: "1"
  };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9", "--soft"], dir, env);
  assert.equal(r.code, 0, `--soft must NOT fail when gh release create fails:\n${r.err}`);
  assert.match(r.err, /gh release create failed|unaffected/i, "should note the failed create without failing");
}

// ---- Case 11: --soft + gh absent → skip-not-fail (the central red line) -----
// This is the exact branch the cut finishing step relies on: an absent gh during
// a release must SKIP, never fail. Without --soft this same input exits 1 (Case 8).
{
  const { dir } = releaseFixture();
  const env = { ...process.env, CW_RELEASE_FLOW_GH_CMD: path.join(dir, "no-such-gh") };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9", "--soft"], dir, env);
  assert.equal(r.code, 0, "--soft must skip (exit 0) when gh is absent");
  assert.match(r.err, /gh CLI not available/i, "should note gh is unavailable");
  assert.match(r.out, /"soft": true/, "summary reflects soft mode");
}

// ---- Case 12: present-but-unauthenticated gh → required fails, soft skips ----
{
  const { dir } = releaseFixture();
  const stub = writeGhStub(dir);
  const base = {
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: path.join(dir, "rec.txt"),
    GH_STUB_SENTINEL: path.join(dir, "sentinel"),
    GH_STUB_UNAUTH: "1"
  };
  const reqd = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, { ...process.env, ...base });
  assert.equal(reqd.code, 1, "unauthenticated gh must fail closed in required --release");
  assert.match(reqd.err, /gh CLI not available\/authenticated/i, "names the auth failure");
  const soft = run("node", [FLOW, "--release", "--version", "9.9.9", "--soft"], dir, { ...process.env, ...base });
  assert.equal(soft.code, 0, "unauthenticated gh is a skip under --soft");
}

// ---- Case 13: a tag with NO committed verdict → notes make no gated claim ----
// Guards the false-green fix: the notes must not assert a review that isn't there.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-rel-${caseId++}-`));
  run("git", ["init", "-q", "-b", "work"], dir);
  run("git", ["config", "user.email", "t@t"], dir);
  run("git", ["config", "user.name", "t"], dir);
  run("git", ["config", "commit.gpgsign", "false"], dir);
  run("git", ["remote", "add", "origin", "https://github.com/test-owner/test-repo.git"], dir);
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## 9.9.9\n\nUngated body.\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "ungated"], dir);
  run("git", ["tag", "-a", "v9.9.9", "-m", "v9.9.9"], dir);  // NO verdict committed
  const stub = writeGhStub(dir);
  const notesOut = path.join(dir, "notes.md");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: path.join(dir, "rec.txt"),
    GH_STUB_SENTINEL: path.join(dir, "sentinel"),
    GH_STUB_NOTES_OUT: notesOut
  };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, env);
  assert.equal(r.code, 0, "release of an ungated tag still succeeds");
  assert.match(r.err, /no committed APPROVED verdict found/i, "warns the operator the tag is ungated");
  const notes = fs.readFileSync(notesOut, "utf8");
  assert.ok(!/independent release-reviewer \(verdict above\)/.test(notes), "must NOT claim a reviewer verdict that isn't committed");
  assert.ok(!/Released through the gated flow/.test(notes), "must NOT claim the gated flow without a verdict");
  assert.match(notes, /Backfilled Release: no committed reviewer verdict/, "emits the honest caveat instead");
  assert.match(notes, /Ungated body/, "still carries the CHANGELOG body");
}

process.stdout.write("release-flow-smoke: ok\n");

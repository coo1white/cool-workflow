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
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const FLOW = path.resolve(__dirname, "..", "scripts", "release-flow.js");
assert.ok(fs.existsSync(FLOW), "release-flow.js must exist");
const VERIFY_SCRIPT = path.resolve(__dirname, "..", "scripts", "verify-verdict-signature.js");
assert.ok(fs.existsSync(VERIFY_SCRIPT), "verify-verdict-signature.js must exist");

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
// verdict arg: APPROVED | MARKDOWN | REJECTED | MIXED | NONE (writes nothing).
function writeStub(dir) {
  const stub = path.join(dir, "stub-agent.js");
  fs.writeFileSync(stub, `
const fs = require("node:fs");
const resultPath = process.argv[2];
const kind = process.argv[3];
if (kind === "APPROVED") fs.writeFileSync(resultPath, "APPROVED " + (process.env.STUB_SHA||"sha") + "\\nstub: capability sentence.\\n");
else if (kind === "MARKDOWN") fs.writeFileSync(resultPath, "review notes\\n\\nAPPROVED " + (process.env.STUB_SHA||"sha") + "\\nstub: capability sentence.\\n");
else if (kind === "REJECTED") fs.writeFileSync(resultPath, "REJECTED\\n1. stub gate failure.\\n");
else if (kind === "MIXED") fs.writeFileSync(resultPath, "REJECTED\\n1. hard failure\\nAPPROVED wrongsha\\nshould not pass\\n");
// NONE: write nothing (simulate an agent that produced no verdict)
process.exit(0);
`);
  return stub;
}

function runFlow(dir, { agentCmd, fileCommand, extraEnv } = {}) {
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
  // A developer's own shell should never leak a real signing key into a
  // sandboxed test run — every case gets this unset unless it opts in via
  // extraEnv below.
  delete env.CW_RELEASE_VERDICT_PRIVKEY;
  if (agentCmd !== undefined) env.CW_AGENT_COMMAND = agentCmd;
  if (extraEnv) Object.assign(env, extraEnv);
  if (fileCommand !== undefined) {
    // Write the durable agent-config.json the way a builtin: expansion (or a
    // hand-written file) leaves it: a SINGLE multi-token `command` string with NO
    // separate `args` array. resolveAgentConfig reads this verbatim (it does NOT
    // re-split a file command), so it reaches delegateReview unsplit — the exact
    // shape that broke builtin: reviewers. Flags/env stay unset so the file wins.
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "agent-config.json"),
      `${JSON.stringify({ schemaVersion: 1, command: fileCommand }, null, 2)}\n`);
  }
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
  // --check skips the live vendor preflight (no keys spent on a dry gate).
  assert.match(r.out, /vendor preflight — skipped/, "check mode skips the live vendor preflight");
}

// ---- Case 1b: a builtin-style (unsplit, multi-token) command spawns correctly
// Regression for the builtin: reviewer bug (v0.1.94). CW_AGENT_COMMAND=builtin:<v>
// expands to "node /abs/wrapper.js {{input}} {{result}}" — ONE unsplit string with
// no args array (the same shape a durable agent-config.json command leaves). The
// old delegateReview ran spawnSync(cfg.command, []) and tried to exec a binary
// literally named "node /abs/... {{input}}" → instant ENOENT, mislabeled as a
// timeout, so the reviewer NEVER ran when configured via builtin:. delegateReview
// must split it into bin + argv (like the orchestrator) and spawn the real binary.
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { fileCommand: `node ${stub} {{result}} APPROVED` });
  assert.equal(r.code, 0, `builtin-style unsplit command must spawn + APPROVE:\n${r.err}\n${r.out}`);
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  const verdict = path.join(dir, ".cw-release", `review-${sha}.verdict`);
  assert.ok(fs.existsSync(verdict), "verdict file must be written from the builtin-style spawn");
  assert.match(fs.readFileSync(verdict, "utf8"), /^APPROVED /, "builtin-style command must produce an APPROVED verdict");
  // The binary must be split out as `node`, NOT the whole command string.
  assert.match(r.out, /\[2\/3\] reviewer — delegating to: node /, "log shows the binary split out as 'node'");
  assert.match(r.out, /"verdict": "APPROVED"/, "summary should report APPROVED for the builtin-style spawn");
}

// ---- Case 1d: the reviewer spawn carries the CW_RELEASE_REVIEW=1 signal -----
// release-flow must tell the delegated reviewer that THIS is a release verdict, so
// gate-capable wrappers (codex-agent.js) raise effort and open an exec-capable
// sandbox. Without the signal a read-only/low reviewer can't run the gate it judges
// and fabricates verdicts — the exact failure this fix removes. The stub records
// the env it was spawned with and proves the flag is "1".
{
  const dir = fixture();
  const stub = path.join(dir, "review-env-stub.js");
  fs.writeFileSync(stub, `
const fs = require("node:fs");
const resultPath = process.argv[2];
fs.writeFileSync(process.env.REVIEW_ENV_OUT, String(process.env.CW_RELEASE_REVIEW));
fs.writeFileSync(resultPath, "APPROVED " + (process.env.STUB_SHA||"sha") + "\\nstub: capability sentence.\\n");
process.exit(0);
`);
  const envOut = path.join(dir, "review-env.txt");
  const home = path.join(dir, ".cw-home");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GATE_CMD: "true",
    STUB_SHA: run("git", ["rev-parse", "HEAD"], dir).out.trim(),
    CW_NO_AUTO_AGENT: "1", CW_HOME: home, XDG_STATE_HOME: home,
    REVIEW_ENV_OUT: envOut,
    CW_AGENT_COMMAND: `node ${stub} {{result}}`
  };
  const r = run("node", [FLOW, "--check"], dir, env);
  assert.equal(r.code, 0, `signal-carrying reviewer should pass:\n${r.err}\n${r.out}`);
  assert.equal(fs.readFileSync(envOut, "utf8"), "1", "reviewer spawn must set CW_RELEASE_REVIEW=1");
}

// ---- Case 1c: markdown-wrapped APPROVED file is normalized -----------------
// Some reviewer agents persist their full response to {{result}} even when the
// exact APPROVED line appears later. Normalize that strict line instead of
// forcing the operator to hand-write the verdict.
{
  const dir = fixture();
  const stub = writeStub(dir);
  const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} MARKDOWN` });
  assert.equal(r.code, 0, `markdown-wrapped APPROVED verdict should pass:\n${r.err}\n${r.out}`);
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  const verdict = path.join(dir, ".cw-release", `review-${sha}.verdict`);
  assert.equal(fs.readFileSync(verdict, "utf8").split(/\r?\n/)[0], `APPROVED ${sha}`, "verdict file is normalized to strict first-line APPROVED");
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

// Fixture proving prevTagOf must find the true previous tag even when it is
// NOT an ancestor of the release commit — the real shape of this repo's
// release process: every release-cut tag lives on an ephemeral branch that
// never merges into main as an ancestor (main instead gets a separate small
// "record the reviewer verdict" PR built on its own history). v9.9.7 sits in
// the real ancestry (an older release, from before the branch point);
// v9.9.8 sits on a sibling branch that v9.9.9's history never merges — a
// naive ancestry walk (`git describe`) skips v9.9.8 and wrongly lands on
// v9.9.7, one version further back than the correct previous release.
function releaseFixtureNonAncestorPrevTag() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-rel-na-${caseId++}-`));
  run("git", ["init", "-q", "-b", "work"], dir);
  run("git", ["config", "user.email", "t@t"], dir);
  run("git", ["config", "user.name", "t"], dir);
  run("git", ["config", "commit.gpgsign", "false"], dir);
  run("git", ["remote", "add", "origin", "https://github.com/test-owner/test-repo.git"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "init"], dir);
  run("git", ["tag", "-a", "v9.9.7", "-m", "v9.9.7"], dir);
  fs.writeFileSync(path.join(dir, "later.txt"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "later main work"], dir);
  const mainlineSha = run("git", ["rev-parse", "HEAD"], dir).out.trim();

  // v9.9.8 is tagged on a sibling branch that never merges back into "work".
  run("git", ["checkout", "-q", "-b", "cut/9.9.8", mainlineSha], dir);
  fs.writeFileSync(path.join(dir, "release-998.txt"), "x\n");
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "release content for 9.9.8"], dir);
  run("git", ["tag", "-a", "v9.9.8", "-m", "v9.9.8"], dir);
  run("git", ["checkout", "-q", "work"], dir);

  fs.writeFileSync(path.join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## 9.9.9\n\nTest release body line.\n\n- bullet one\n- bullet two\n\n## 9.9.7\n\nold.\n");
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

// ---- Case 6b: prevTagOf finds the true previous tag even when it is NOT an
// ancestor of the release commit (v0.2.4's "Full diff" landed on v0.2.2...v0.2.4
// instead of v0.2.3...v0.2.4 in production — this is that exact shape) --------
{
  const { dir } = releaseFixtureNonAncestorPrevTag();
  const stub = writeGhStub(dir);
  const notesOut = path.join(dir, "captured-notes.md");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GH_CMD: stub,
    GH_STUB_REC: path.join(dir, "gh-rec.txt"),
    GH_STUB_SENTINEL: path.join(dir, "gh-sentinel"),
    GH_STUB_NOTES_OUT: notesOut
  };
  const r = run("node", [FLOW, "--release", "--version", "9.9.9"], dir, env);
  assert.equal(r.code, 0, `--release should succeed:\n${r.err}\n${r.out}`);
  const notes = fs.readFileSync(notesOut, "utf8");
  assert.match(notes, /compare\/v9\.9\.8\.\.\.v9\.9\.9/,
    "the true previous tag (v9.9.8, not an ancestor) must back the compare link");
  assert.doesNotMatch(notes, /compare\/v9\.9\.7\.\.\.v9\.9\.9/,
    "must not skip past the non-ancestor tag to the older ancestor tag");
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

// ---- Case: --cut runs the live vendor preflight and HARD-BLOCKS on failure ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const home = path.join(dir, ".cw-home");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GATE_CMD: "true",
    CW_RELEASE_FLOW_PREFLIGHT_CMD: "false", // stub: a promised vendor is not live
    // Cleared, not just left to ...process.env: an operator's shell may itself have
    // CW_SKIP_VENDOR_PREFLIGHT=1 set (e.g. mid-incident, overriding a real --cut
    // elsewhere) and this nested simulated cut must not inherit it — that would
    // silently turn the stubbed-FAIL preflight into a pass and false-green this
    // exact "hard-blocks" assertion.
    CW_SKIP_VENDOR_PREFLIGHT: "",
    STUB_SHA: run("git", ["rev-parse", "HEAD"], dir).out.trim(),
    CW_NO_AUTO_AGENT: "1", CW_HOME: home, XDG_STATE_HOME: home,
    CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED`
  };
  const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, env);
  assert.equal(r.code, 1, "a failing vendor preflight blocks the cut");
  assert.match(r.err, /vendor preflight FAILED/, "operator is told which step blocked");
  assert.match(r.out, /\[1b\/3\] vendor preflight — live/, "preflight runs in cut mode");
  assert.doesNotMatch(r.out, /\[2\/3\] reviewer/, "blocks BEFORE the reviewer step");
}

// ---- Case: --cut with a green preflight proceeds past it to the reviewer ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const home = path.join(dir, ".cw-home");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GATE_CMD: "true",
    CW_RELEASE_FLOW_PREFLIGHT_CMD: "true", // stub: all vendors live
    // See the "hard-blocks" case above: clear an inherited CW_SKIP_VENDOR_PREFLIGHT
    // so this asserts the LIVE-preflight path, not a coincidentally-skipped one.
    CW_SKIP_VENDOR_PREFLIGHT: "",
    STUB_SHA: run("git", ["rev-parse", "HEAD"], dir).out.trim(),
    CW_NO_AUTO_AGENT: "1", CW_HOME: home, XDG_STATE_HOME: home,
    CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED`
  };
  const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, env);
  assert.equal(r.code, 0, `green preflight + APPROVED proceeds:\n${r.err}\n${r.out}`);
  assert.match(r.out, /\[1b\/3\] vendor preflight — live/, "preflight runs in cut mode");
  assert.match(r.out, /"verdict": "APPROVED"/, "flow completes through the reviewer");
}

// ---- Case: CW_SKIP_VENDOR_PREFLIGHT=1 overrides the live check on --cut ----
{
  const dir = fixture();
  const stub = writeStub(dir);
  const home = path.join(dir, ".cw-home");
  const env = {
    ...process.env,
    CW_RELEASE_FLOW_GATE_CMD: "true",
    CW_RELEASE_FLOW_PREFLIGHT_CMD: "false", // would fail, but the skip wins
    CW_SKIP_VENDOR_PREFLIGHT: "1",
    STUB_SHA: run("git", ["rev-parse", "HEAD"], dir).out.trim(),
    CW_NO_AUTO_AGENT: "1", CW_HOME: home, XDG_STATE_HOME: home,
    CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED`
  };
  const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, env);
  assert.equal(r.code, 0, `escape hatch lets the cut proceed:\n${r.err}\n${r.out}`);
  assert.match(r.out, /vendor preflight — SKIPPED via CW_SKIP_VENDOR_PREFLIGHT/, "escape hatch is reported");
}

// ---- Verdict signing (opt-in — see scripts/verdict-keygen.js) --------------
// NOTE: every case here uses --check (or --cut --dry-run, which signs BEFORE
// cut()'s dry-run short-circuit) — never a real --cut. A non-dry-run --cut
// runs `npm run bump:version`/`sync:project-index` against pluginRoot (the
// REAL plugins/cool-workflow checkout, resolved from release-flow.js's own
// __dirname, not the fixture), which would mutate this actual working tree.
// Every existing --cut case in this file is --dry-run for the same reason;
// the git-add-the-.sig-sidecar line inside cut() is verified by inspection
// (it mirrors the adjacent, already-covered git-add-the-verdict line exactly).
{
  const dir = fixture();
  const keyPath = path.join(dir, "verdict-signing.key");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
  const verdictPath = path.join(dir, ".cw-release", `review-${sha}.verdict`);
  const sigPath = `${verdictPath}.sig`;
  const pubPath = path.join(dir, "verdict-signing.pub");
  fs.writeFileSync(pubPath, pubPem);

  // ---- Case: CW_RELEASE_VERDICT_PRIVKEY set -> .sig written + verifies ----
  {
    const stub = writeStub(dir);
    const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} APPROVED`, extraEnv: { CW_RELEASE_VERDICT_PRIVKEY: keyPath } });
    assert.equal(r.code, 0, `signed APPROVED check should pass:\n${r.err}\n${r.out}`);
    assert.match(r.out, /verdict signed/, "flow should report the verdict was signed");
    assert.ok(fs.existsSync(sigPath), ".sig sidecar must be written next to the verdict");
    const verify = spawnSync("node", [VERIFY_SCRIPT, verdictPath, sigPath, pubPath], { encoding: "utf8" });
    assert.equal(verify.status, 0, `verify-verdict-signature.js must accept a real signature: ${verify.stderr}`);
  }

  // ---- Case: verdict edited after signing -> verification now fails ----
  // (proves the signature covers the verdict CONTENT, not just its existence)
  {
    fs.writeFileSync(verdictPath, `APPROVED ${sha}\nTAMPERED capability line.\n`);
    const verify = spawnSync("node", [VERIFY_SCRIPT, verdictPath, sigPath, pubPath], { encoding: "utf8" });
    assert.notEqual(verify.status, 0, "a verdict tampered after signing must fail signature verification");
  }

  // ---- Case: CW_RELEASE_VERDICT_PRIVKEY NOT set -> no .sig, unchanged default ----
  {
    fs.rmSync(path.join(dir, ".cw-release"), { recursive: true, force: true });
    const stub = writeStub(dir);
    const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} APPROVED` });
    assert.equal(r.code, 0, `unsigned APPROVED check should still pass:\n${r.err}\n${r.out}`);
    assert.doesNotMatch(r.out, /verdict signed/, "flow must not claim signing when no key is configured");
    assert.ok(!fs.existsSync(sigPath), "no .sig sidecar without CW_RELEASE_VERDICT_PRIVKEY (opt-in, backward compatible)");
  }

  // ---- Case: CW_RELEASE_VERDICT_PRIVKEY points at garbage -> fail closed ----
  {
    fs.rmSync(path.join(dir, ".cw-release"), { recursive: true, force: true });
    const badKeyPath = path.join(dir, "not-a-key.txt");
    fs.writeFileSync(badKeyPath, "this is not a PEM key\n");
    const stub = writeStub(dir);
    const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} APPROVED`, extraEnv: { CW_RELEASE_VERDICT_PRIVKEY: badKeyPath } });
    assert.notEqual(r.code, 0, "a misconfigured signing key must fail closed, not silently emit an unsigned verdict");
    assert.match(r.err, /failed to sign the verdict/, "should explain the signing failure");
  }

  // ---- Case: CW_RELEASE_VERDICT_PRIVKEY is a real PEM key but the WRONG
  // algorithm (RSA, not ed25519) -> fail closed at signing time -----------
  // node:crypto's crypto.sign(null, ...) does NOT throw for an RSA/EC key; it
  // silently signs with that algorithm's own default digest, producing a
  // syntactically valid .sig that could never verify against the committed
  // ed25519 public key. Without this check the operator would only find out
  // at CI (or never, if no pubkey is committed yet) instead of right here.
  {
    fs.rmSync(path.join(dir, ".cw-release"), { recursive: true, force: true });
    const rsaKeyPath = path.join(dir, "rsa.key");
    const rsaKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    fs.writeFileSync(rsaKeyPath, rsaKey.export({ type: "pkcs8", format: "pem" }));
    const stub = writeStub(dir);
    const r = runFlow(dir, { agentCmd: `node ${stub} {{result}} APPROVED`, extraEnv: { CW_RELEASE_VERDICT_PRIVKEY: rsaKeyPath } });
    assert.notEqual(r.code, 0, "a non-ed25519 key must fail closed, not produce a signature that can never verify");
    assert.match(r.err, /not ed25519/, "should name the wrong key type");
    assert.ok(!fs.existsSync(sigPath), "no .sig sidecar must be written for a rejected key type");
  }

  // ---- Case: signing happens even under --cut --dry-run (before the
  // dry-run short-circuit inside cut()), proving the ordering is sign-first ----
  {
    fs.rmSync(path.join(dir, ".cw-release"), { recursive: true, force: true });
    const stub = writeStub(dir);
    const home = path.join(dir, ".cw-home");
    const env = {
      ...process.env,
      CW_RELEASE_FLOW_GATE_CMD: "true",
      // --cut runs the LIVE vendor preflight unless skipped; the other --cut
      // cases in this file all stub or skip it the same way.
      CW_SKIP_VENDOR_PREFLIGHT: "1",
      STUB_SHA: sha,
      CW_NO_AUTO_AGENT: "1",
      CW_HOME: home,
      XDG_STATE_HOME: home,
      CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED`,
      CW_RELEASE_VERDICT_PRIVKEY: keyPath
    };
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, env);
    assert.equal(r.code, 0, `signed --cut --dry-run should pass:\n${r.err}\n${r.out}`);
    assert.ok(fs.existsSync(sigPath), "signing runs before cut()'s dry-run short-circuit");
    const verify = spawnSync("node", [VERIFY_SCRIPT, verdictPath, sigPath, pubPath], { encoding: "utf8" });
    assert.equal(verify.status, 0, "the --cut --dry-run signature must also verify");
  }
}

// ---- Cut preflight (fail fast BEFORE the gate/vendor/reviewer) --------------
// Each case here was a REAL post-reviewer failure in the v0.2.3 cut: the check
// must fire before the gate command runs. The gate stub is a POISON command
// (exit 1 with a marker) — if any preflight case ever reaches the gate, the
// output shows GATE_RAN and the assertion names the ordering regression.
{
  const poisonGate = "echo GATE_RAN; exit 1";
  const preflightEnv = (dir, extra = {}) => {
    const home = path.join(dir, ".cw-home");
    const env = {
      ...process.env,
      CW_RELEASE_FLOW_GATE_CMD: poisonGate,
      CW_NO_AUTO_AGENT: "1",
      CW_HOME: home,
      XDG_STATE_HOME: home
    };
    // Scrub host leakage FIRST, then apply the case's own opt-ins — the
    // wrong-key case passes CW_RELEASE_VERDICT_PRIVKEY via `extra` and it
    // must survive the scrub.
    delete env.CW_RELEASE_VERDICT_PRIVKEY;
    delete env.CW_AGENT_COMMAND;
    delete env.CW_AGENT_ENDPOINT;
    return { ...env, ...extra };
  };

  // ---- Case: --cut with no --version dies BEFORE the gate ----
  {
    const dir = fixture();
    const r = run("node", [FLOW, "--cut", "--dry-run"], dir, preflightEnv(dir));
    assert.notEqual(r.code, 0, "--cut without --version must fail");
    assert.match(r.err, /--cut requires --version/, "should name the missing flag");
    assert.doesNotMatch(r.out, /GATE_RAN/, "the version check must fire BEFORE the gate (was: after the reviewer)");
  }

  // ---- Case: committed pubkey + no CW_RELEASE_VERDICT_PRIVKEY dies BEFORE the gate ----
  {
    const dir = fixture();
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(path.join(dir, ".cw-release"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cw-release", "verdict-signing.pub"), publicKey.export({ type: "spki", format: "pem" }));
    run("git", ["add", "-A"], dir);
    run("git", ["commit", "-q", "-m", "pubkey"], dir);
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, preflightEnv(dir));
    assert.notEqual(r.code, 0, "a committed pubkey with no private key must fail the cut up front");
    assert.match(r.err, /requires a SIGNED verdict/, "should explain the signing requirement");
    assert.match(r.err, /CW_RELEASE_VERDICT_PRIVKEY/, "should name the fix");
    assert.doesNotMatch(r.out, /GATE_RAN/, "the signing check must fire BEFORE the gate (v0.2.3 failed only in CI)");
  }

  // ---- Case: privkey set but does NOT match the committed pubkey -> dies ----
  {
    const dir = fixture();
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const wrongKey = crypto.generateKeyPairSync("ed25519").privateKey;
    fs.mkdirSync(path.join(dir, ".cw-release"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cw-release", "verdict-signing.pub"), publicKey.export({ type: "spki", format: "pem" }));
    const wrongKeyPath = path.join(dir, "wrong.key");
    fs.writeFileSync(wrongKeyPath, wrongKey.export({ type: "pkcs8", format: "pem" }));
    run("git", ["add", "-A"], dir);
    run("git", ["commit", "-q", "-m", "pubkey"], dir);
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir,
      preflightEnv(dir, { CW_RELEASE_VERDICT_PRIVKEY: wrongKeyPath }));
    assert.notEqual(r.code, 0, "a wrong signing key must fail up front (it signs fine but CI rejects it)");
    assert.match(r.err, /does not match the committed/, "should say the key does not match");
    assert.doesNotMatch(r.out, /GATE_RAN/, "the key-match check must fire BEFORE the gate");
  }

  // ---- Case: tag already exists locally -> dies BEFORE the gate ----
  {
    const dir = fixture();
    run("git", ["tag", "-a", "v9.9.9", "-m", "stale"], dir);
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, preflightEnv(dir));
    assert.notEqual(r.code, 0, "a pre-existing local tag must fail the cut up front");
    assert.match(r.err, /already exists locally/, "should name the stale tag");
    assert.doesNotMatch(r.out, /GATE_RAN/, "the tag check must fire BEFORE the gate (v0.2.3 died at the last step)");
  }

  // ---- Case: CHANGELOG.md present but missing the section -> dies BEFORE the gate ----
  {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## 0.0.1\n\nold notes\n");
    run("git", ["add", "-A"], dir);
    run("git", ["commit", "-q", "-m", "changelog"], dir);
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, preflightEnv(dir));
    assert.notEqual(r.code, 0, "a CHANGELOG without the release section must fail up front");
    assert.match(r.err, /CHANGELOG\.md has no "## 9\.9\.9" section/, "should name the missing section");
    assert.doesNotMatch(r.out, /GATE_RAN/, "the CHANGELOG check must fire BEFORE the gate");
  }

  // ---- Case: dirty tracked tree -> dies BEFORE the gate; untracked strays are fine ----
  {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, "README.md"), "modified\n"); // tracked, dirty
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--dry-run"], dir, preflightEnv(dir));
    assert.notEqual(r.code, 0, "tracked modifications must fail the cut up front");
    assert.match(r.err, /tracked modifications/, "should say what is dirty");
    assert.doesNotMatch(r.out, /GATE_RAN/, "the clean-tree check must fire BEFORE the gate");

    // untracked files are NOT a cut hazard (git add -u never sweeps them in)
    run("git", ["checkout", "--", "README.md"], dir);
    fs.writeFileSync(path.join(dir, "untracked-stray.txt"), "x\n");
    const r2 = run("node", [FLOW, "--cut", "--version", "9.9.9", "--push", "--preflight-only"], dir, preflightEnv(dir));
    assert.equal(r2.code, 0, `an untracked stray must NOT block the preflight:\n${r2.err}\n${r2.out}`);
  }

  // ---- Case: clean fixture passes --preflight-only and stops (no gate) ----
  {
    const dir = fixture();
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--push", "--preflight-only"], dir, preflightEnv(dir));
    assert.equal(r.code, 0, `a clean preflight-only run should pass:\n${r.err}\n${r.out}`);
    assert.match(r.out, /"mode": "preflight"/, "preflight-only reports its mode");
    assert.doesNotMatch(r.out, /GATE_RAN/, "--preflight-only must never reach the gate");
  }

  // ---- Case: --preflight-only WITHOUT --cut is refused (no silent ok:true) ----
  {
    const dir = fixture();
    const r = run("node", [FLOW, "--preflight-only"], dir, preflightEnv(dir));
    assert.notEqual(r.code, 0, "--preflight-only without --cut must be refused, not answer ok:true with zero checks run");
    assert.match(r.err, /--preflight-only requires --cut/, "should name the missing mode");
  }

  // ---- Cases: the network-dependent preflight checks (block f), fully offline
  // via a local bare `origin`: remote-tag-exists, stale HEAD, and the
  // --allow-stale-head escape. These lines had zero test execution before. ----
  {
    const dir = fixture();
    // a bare origin whose `main` is the fixture's current commit
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), `cw-flow-origin-${caseId++}-`));
    run("git", ["init", "-q", "--bare", "-b", "main", bare], dir);
    run("git", ["remote", "add", "origin", bare], dir);
    run("git", ["push", "-q", "origin", "HEAD:main"], dir);

    // (f1) remote tag exists -> die before the gate
    run("git", ["push", "-q", "origin", "HEAD:refs/tags/v9.9.9"], dir);
    const r1 = run("node", [FLOW, "--cut", "--version", "9.9.9", "--push", "--preflight-only"], dir, preflightEnv(dir));
    assert.notEqual(r1.code, 0, "a tag already on origin must fail the preflight");
    assert.match(r1.err, /already exists on origin/, "should say the version is already published");
    run("git", ["push", "-q", "origin", ":refs/tags/v9.9.9"], dir);

    // (f2) HEAD behind origin/main -> die; --allow-stale-head -> pass
    fs.writeFileSync(path.join(dir, "extra.txt"), "x\n");
    run("git", ["add", "-A"], dir);
    run("git", ["commit", "-q", "-m", "ahead"], dir);
    run("git", ["push", "-q", "origin", "HEAD:main"], dir);
    run("git", ["reset", "-q", "--hard", "HEAD~1"], dir); // HEAD now behind origin/main
    const r2 = run("node", [FLOW, "--cut", "--version", "9.9.9", "--push", "--preflight-only"], dir, preflightEnv(dir));
    assert.notEqual(r2.code, 0, "a HEAD behind the origin/main tip must fail the preflight");
    assert.match(r2.err, /not the origin\/main tip/, "should say HEAD is stale");
    const r3 = run("node", [FLOW, "--cut", "--version", "9.9.9", "--push", "--preflight-only", "--allow-stale-head"], dir, preflightEnv(dir));
    assert.equal(r3.code, 0, `--allow-stale-head must skip only the tip check:\n${r3.err}\n${r3.out}`);
  }

  // ---- Case: --dry-run cut pushes the TAG ONLY (no HEAD / branch push) ----
  // The old refspec (`git push --atomic origin HEAD v<x>`) either hit main's
  // branch protection or minted a stray remote branch named after the local
  // branch. The dry-run line is the pinned contract for the new shape.
  {
    const dir = fixture();
    const stub = writeStub(dir);
    const home = path.join(dir, ".cw-home");
    const sha = run("git", ["rev-parse", "HEAD"], dir).out.trim();
    const env = {
      ...process.env,
      CW_RELEASE_FLOW_GATE_CMD: "true",
      CW_SKIP_VENDOR_PREFLIGHT: "1",
      STUB_SHA: sha,
      CW_NO_AUTO_AGENT: "1",
      CW_HOME: home,
      XDG_STATE_HOME: home,
      CW_AGENT_COMMAND: `node ${stub} {{result}} APPROVED`
    };
    delete env.CW_RELEASE_VERDICT_PRIVKEY;
    const r = run("node", [FLOW, "--cut", "--version", "9.9.9", "--push", "--dry-run"], dir, env);
    assert.equal(r.code, 0, `dry-run cut with --push should pass:\n${r.err}\n${r.out}`);
    assert.match(r.out, /push refs\/tags\/v9\.9\.9 \(tag only, no branch\)/, "the push must be tag-only");
    assert.doesNotMatch(r.out, /would:.*push HEAD|push.*HEAD.*v9\.9\.9/, "no HEAD/branch push may remain in the plan line");
  }
}

process.stdout.write("release-flow-smoke: ok\n");

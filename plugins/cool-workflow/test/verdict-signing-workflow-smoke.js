#!/usr/bin/env node
"use strict";

// verdict-signing-workflow-smoke — extracts the ACTUAL `run:` bash block for
// the verdict-signature-verification step out of .github/workflows/
// release-gate.yml and npm-publish.yml (byte-for-byte, not a hand copy — so
// this can never drift from the real file) and executes it against
// throwaway git fixtures. This is the ONLY automated coverage of that bash
// logic: it is otherwise only exercised by a real tag push / dispatch in CI,
// so a future edit that reintroduces the bare-relative-path bug (fixed
// during this same review cycle), swaps the $VERDICT/$SIG argument order, or
// breaks the PUBKEY variable would pass every other test and only be caught
// the next time an actual release runs the real workflow.
//
// Both workflow files avoid `${{ }}` GitHub Actions interpolation INSIDE the
// run: block itself (values are threaded through env: instead, per the P2/P3
// fix in this same review cycle) — so the extracted text is plain,
// executable bash with no templating left to resolve. TAG_REF (the one
// remaining external input, for npm-publish.yml) is supplied as a real shell
// env var here, exactly as GitHub Actions' `env:` mapping would.
//
// Portable: node + git + bash only, isolated tmpdirs.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pluginRoot = path.resolve(__dirname, "..");
const GATE_YML = path.join(repoRoot, ".github", "workflows", "release-gate.yml");
const PUBLISH_YML = path.join(repoRoot, ".github", "workflows", "npm-publish.yml");
const VERIFY_SCRIPT = path.join(pluginRoot, "scripts", "verify-verdict-signature.js");
for (const f of [GATE_YML, PUBLISH_YML, VERIFY_SCRIPT]) assert.ok(fs.existsSync(f), `${f} must exist`);

/** Extracts the `run: |` block scalar body for the step whose `name:` line
 *  contains `stepName`, dedented to plain shell text. Reads the REAL file
 *  fresh every call — there is no hand-copied string anywhere in this file
 *  to drift from the workflow source. */
function extractRunBlock(yamlPath, stepName) {
  const lines = fs.readFileSync(yamlPath, "utf8").split(/\r?\n/);
  const nameIdx = lines.findIndex((l) => l.includes(`name: ${stepName}`));
  assert.ok(nameIdx >= 0, `step "${stepName}" not found in ${yamlPath}`);
  let runIdx = -1;
  let runIndent = -1;
  for (let i = nameIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*\|\s*$/);
    if (m) {
      runIdx = i;
      runIndent = m[1].length;
      break;
    }
    // A sibling step starting before we find `run: |` means this step has no
    // block-scalar run (shouldn't happen for the steps this test targets).
    assert.ok(!/^\s*-\s+name:/.test(lines[i]) || i === nameIdx, `no "run: |" found for step "${stepName}" before the next step`);
  }
  assert.ok(runIdx >= 0, `"run: |" not found after step "${stepName}"`);
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== "" && line.match(/^(\s*)/)[1].length <= runIndent) break;
    body.push(line);
  }
  const firstContentLine = body.find((l) => l.trim() !== "");
  assert.ok(firstContentLine, `"run: |" block for step "${stepName}" is empty`);
  const dedent = firstContentLine.match(/^(\s*)/)[1].length;
  return body.map((l) => (l.length >= dedent ? l.slice(dedent) : l)).join("\n");
}

const gateScript = extractRunBlock(GATE_YML, "Verify reviewer verdict was committed");
const publishScript = extractRunBlock(PUBLISH_YML, "Verify the dispatched ref is a real, gated release tag");

// Sanity: both extracted scripts must actually reference the verify script
// and the pubkey path — proves the extraction landed on real content, not an
// empty/wrong block due to a future rename of the step.
for (const [label, script] of [["release-gate.yml", gateScript], ["npm-publish.yml", publishScript]]) {
  assert.match(script, /verify-verdict-signature\.js/, `${label}'s extracted block must reference verify-verdict-signature.js`);
  assert.match(script, /verdict-signing\.pub/, `${label}'s extracted block must reference verdict-signing.pub`);
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

function sign(verdictPath) {
  const message = fs.readFileSync(verdictPath);
  return crypto.sign(null, message, crypto.createPrivateKey(PRIV_PEM)).toString("base64");
}

/** Builds a throwaway repo shaped exactly like a real cut(): a "reviewed"
 *  content commit R, then a child commit R2 that adds the verdict (+ sig +
 *  pubkey, when requested) and is tagged — mirroring release-flow.js's
 *  cut() (verdict commit is the reviewed sha's CHILD; the tag lands on the
 *  child). Returns { dir, R, R2 } (R2 == HEAD == the tag's commit). */
function buildFixture({ committedPubkey = false, sigFor, tamperAfterSigning = false, forgedHeadVerdict = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-wf-sig-"));
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "t@t"], dir);
  git(["config", "user.name", "t"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  fs.mkdirSync(path.join(dir, "plugins", "cool-workflow", "scripts"), { recursive: true });
  fs.copyFileSync(VERIFY_SCRIPT, path.join(dir, "plugins", "cool-workflow", "scripts", "verify-verdict-signature.js"));
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "reviewed content"], dir);
  const R = git(["rev-parse", "HEAD"], dir);

  fs.mkdirSync(path.join(dir, ".cw-release"), { recursive: true });
  const verdictPath = path.join(dir, ".cw-release", `review-${R}.verdict`);
  fs.writeFileSync(verdictPath, `APPROVED ${R}\ncap.\n`);
  if (sigFor === "real") fs.writeFileSync(`${verdictPath}.sig`, `${sign(verdictPath)}\n`);
  if (tamperAfterSigning) fs.writeFileSync(verdictPath, `APPROVED ${R}\nTAMPERED.\n`);
  if (committedPubkey) fs.writeFileSync(path.join(dir, ".cw-release", "verdict-signing.pub"), PUB_PEM);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "chore(release): record APPROVED reviewer verdict"], dir);
  const R2 = git(["rev-parse", "HEAD"], dir);
  const HEAD = R2;
  git(["tag", "-a", "v9.9.9", "-m", "v9.9.9"], dir);

  if (forgedHeadVerdict) {
    // A forged verdict "approving" HEAD (R2) itself, with a bogus signature —
    // planted to prove the loop's `continue` really reaches the R (HEAD~1)
    // candidate rather than short-circuiting on the first hit. This can only
    // be a real commit's own committed content for a PARENT commit (a
    // self-naming verdict inside its own commit is cryptographically
    // infeasible: the commit's sha is a hash of a tree that would have to
    // already contain that same sha). The check itself is a plain filesystem
    // read (`[ -f ... ]`/grep), not `git show`, so planting it directly in
    // the working tree — uncommitted, on top of the already-tagged HEAD —
    // reproduces exactly what an attacker able to write to the checkout
    // (or a forged/untagged ref pointing at doctored working-tree state)
    // could do, without disturbing which commit HEAD/HEAD~1 actually are.
    const forgedPath = path.join(dir, ".cw-release", `review-${R2}.verdict`);
    fs.writeFileSync(forgedPath, `APPROVED ${R2}\nforged cap.\n`);
    fs.writeFileSync(`${forgedPath}.sig`, `${Buffer.from("not a real signature").toString("base64")}\n`);
  }
  return { dir, R, R2, HEAD };
}

function runScript(script, cwd, env) {
  const scriptPath = path.join(cwd, "__run.sh");
  fs.writeFileSync(scriptPath, script);
  // -eo pipefail matches GitHub Actions' actual default `bash` shell for
  // run: steps, so a compound-command exemption (e.g. `if node ...; then`)
  // behaves identically here to how it behaves in real CI.
  const r = spawnSync("bash", ["-eo", "pipefail", scriptPath], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  fs.rmSync(scriptPath, { force: true });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// ============================================================================
// release-gate.yml — runs from the repo root (no working-directory override)
// ============================================================================

// (a) no pubkey committed -> grep-only fallback, unchanged legacy behavior
{
  const { dir } = buildFixture({ committedPubkey: false });
  const r = runScript(gateScript, dir);
  assert.equal(r.code, 0, `(a) no pubkey should pass grep-only:\n${r.err}`);
  assert.match(r.out, /no verdict-signing\.pub committed yet/, "(a) should report the no-pubkey fallback");
}

// (b) pubkey committed + valid signature -> passes, signature verified
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: "real" });
  const r = runScript(gateScript, dir);
  assert.equal(r.code, 0, `(b) valid signature should pass:\n${r.err}`);
  assert.match(r.out, /signature verified/, "(b) should report signature verified");
}

// (c) pubkey committed, verdict present, NO .sig -> fails closed
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: undefined });
  const r = runScript(gateScript, dir);
  assert.notEqual(r.code, 0, "(c) missing .sig must fail closed once a pubkey is committed");
}

// (d) pubkey committed + verdict tampered after signing -> stale signature, fails closed
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: "real", tamperAfterSigning: true });
  const r = runScript(gateScript, dir);
  assert.notEqual(r.code, 0, "(d) a verdict edited after signing must fail closed (stale signature)");
}

// (e) loop continuation: a forged, invalidly-signed verdict AT LITERAL HEAD
// must not short-circuit the loop -- it must fall through (`continue`) to the
// genuine valid verdict at HEAD~1 and still pass.
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: "real", forgedHeadVerdict: true });
  const r = runScript(gateScript, dir);
  assert.equal(r.code, 0, `(e) loop must continue past a forged HEAD candidate to the valid HEAD~1 one:\n${r.err}\n${r.out}`);
  assert.match(r.out, /has no valid signature — trying the other candidate/, "(e) should report trying the next candidate");
  assert.match(r.out, /signature verified/, "(e) should ultimately verify the real HEAD~1 verdict");
}

// ============================================================================
// npm-publish.yml — runs with working-directory: plugins/cool-workflow, and
// needs TAG_REF (normally supplied via the step's env:) plus a real tag.
// ============================================================================

function runPublishScript(fixture, env) {
  return runScript(publishScript, path.join(fixture.dir, "plugins", "cool-workflow"), { TAG_REF: "v9.9.9", ...env });
}

// (a) no pubkey committed -> grep-only fallback
{
  const fixture = buildFixture({ committedPubkey: false });
  const r = runPublishScript(fixture);
  assert.equal(r.code, 0, `(a) no pubkey should pass grep-only:\n${r.err}`);
  assert.match(r.out, /no verdict-signing\.pub committed yet/, "(a) should report the no-pubkey fallback");
}

// (b) pubkey committed + valid signature -> passes
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: "real" });
  const r = runPublishScript(fixture);
  assert.equal(r.code, 0, `(b) valid signature should pass:\n${r.err}`);
  assert.match(r.out, /signature verified/, "(b) should report signature verified");
}

// (c) pubkey committed, no .sig -> fails closed
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: undefined });
  const r = runPublishScript(fixture);
  assert.notEqual(r.code, 0, "(c) missing .sig must fail closed once a pubkey is committed");
}

// (d) pubkey committed + tampered verdict -> fails closed
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: "real", tamperAfterSigning: true });
  const r = runPublishScript(fixture);
  assert.notEqual(r.code, 0, "(d) a verdict edited after signing must fail closed");
}

// (e) loop continuation, same as release-gate.yml above
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: "real", forgedHeadVerdict: true });
  const r = runPublishScript(fixture);
  assert.equal(r.code, 0, `(e) loop must continue past a forged HEAD candidate to the valid HEAD~1 one:\n${r.err}\n${r.out}`);
  assert.match(r.out, /signature verified/, "(e) should ultimately verify the real HEAD~1 verdict");
}

// (f) npm-publish.yml-specific: a dispatched ref that isn't a real tag must
// still be rejected BEFORE the verdict loop even runs (the tag-existence
// check earlier in the same run: block).
{
  const fixture = buildFixture({ committedPubkey: false });
  const r = runPublishScript(fixture, { TAG_REF: "v0.0.0-not-a-real-tag" });
  assert.notEqual(r.code, 0, "(f) a non-existent tag ref must be rejected");
  // `echo "::error::..."` writes to stdout (a GitHub Actions annotation), not stderr.
  assert.match(r.out, /does not exist/, "(f) should explain the ref does not resolve to a real tag");
}

// ============================================================================
// verify-verdict-signature.js's own exit-code contract: 2 for a usage/argv
// error, 1 for every verification failure. Nothing previously pinned this
// distinction (release-flow-smoke.js only asserts ==0 or !=0), so a future
// refactor could silently collapse or swap it without any test failure.
// ============================================================================
{
  const r = spawnSync("node", [VERIFY_SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 2, "no arguments at all must exit 2 (usage error), not 1");
}
{
  const r = spawnSync("node", [VERIFY_SCRIPT, "only-one-arg"], { encoding: "utf8" });
  assert.equal(r.status, 2, "too few arguments must exit 2 (usage error), not 1");
}
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: undefined });
  const verdictPath = path.join(dir, ".cw-release", `review-${git(["rev-parse", "HEAD~1"], dir)}.verdict`);
  const r = spawnSync(
    "node",
    [VERIFY_SCRIPT, verdictPath, path.join(dir, "no-such.sig"), path.join(dir, ".cw-release", "verdict-signing.pub")],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 1, "a missing signature file (correct argc) must exit 1, not 2 — this is a verification failure, not a usage error");
}

process.stdout.write("verdict-signing-workflow-smoke: ok\n");

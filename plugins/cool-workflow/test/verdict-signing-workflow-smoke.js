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
const BUMP_REPRO_SCRIPT = path.join(pluginRoot, "scripts", "verify-bump-reproduction.js");
const FAKE_DATE_SCRIPT = path.join(pluginRoot, "scripts", "fake-date-for-reproduction.js");
for (const f of [GATE_YML, PUBLISH_YML, VERIFY_SCRIPT, BUMP_REPRO_SCRIPT, FAKE_DATE_SCRIPT]) assert.ok(fs.existsSync(f), `${f} must exist`);

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

// BUG-2 regression (text-only check, not a full YAML parse): the "Verify the
// dispatched ref is a real, gated release tag" step in npm-publish.yml must
// run on EVERY trigger. If it still had `if: github.event_name ==
// 'workflow_dispatch'`, this whole check would be SKIPPED on the normal
// workflow_run path (the one that fires after every real tag push) — the
// job would then trust nothing but release-gate.yml's reported conclusion,
// which for a tag push runs from the pushed tag's OWN, attacker-controlled
// tree.
{
  const rawLines = fs.readFileSync(PUBLISH_YML, "utf8").split(/\r?\n/);
  const nameIdx = rawLines.findIndex((l) => l.includes("name: Verify the dispatched ref is a real, gated release tag"));
  assert.ok(nameIdx >= 0, "step not found for the BUG-2 text check");
  let nextStepIdx = rawLines.length;
  for (let i = nameIdx + 1; i < rawLines.length; i++) {
    if (/^\s*-\s+(name|uses):/.test(rawLines[i])) {
      nextStepIdx = i;
      break;
    }
  }
  const stepBlock = rawLines.slice(nameIdx, nextStepIdx).join("\n");
  assert.ok(
    !/if:\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(stepBlock),
    "the verdict-verification step must not be gated behind a workflow_dispatch-only `if:` any more (BUG 2)"
  );
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
function buildFixture({ committedPubkey = false, sigFor, tamperAfterSigning = false, forgedHeadVerdict = false, breakParentInstall = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-wf-sig-"));
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "t@t"], dir);
  git(["config", "user.name", "t"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  const scriptsDir = path.join(dir, "plugins", "cool-workflow", "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(VERIFY_SCRIPT, path.join(scriptsDir, "verify-verdict-signature.js"));
  fs.copyFileSync(BUMP_REPRO_SCRIPT, path.join(scriptsDir, "verify-bump-reproduction.js"));
  fs.copyFileSync(FAKE_DATE_SCRIPT, path.join(scriptsDir, "fake-date-for-reproduction.js"));
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  // verify-bump-reproduction.js runs `npm install` + `npm run bump:version` +
  // `npm run sync:project-index` for real — this fixture is a MINIMAL real
  // npm project (stub scripts that no-op) so that orchestration is genuinely
  // exercised (worktree creation, npm invocation, tree-hash comparison)
  // without needing the real repo's full canonical-apps/manifest/apps
  // structure. bump-version.js's own correctness is verified separately,
  // directly against real repo history (see the header comment above).
  const pkg = { name: "fixture", version: "1.0.0", scripts: { "bump:version": "true", "sync:project-index": "true" } };
  // breakParentInstall: an unresolvable dependency baked into R (the approved
  // parent, checked out fresh into the scratch worktree) so `npm install`
  // itself fails during REPRODUCTION — standing in for a transient registry
  // hiccup, to prove that fails closed rather than being silently treated as
  // "reproduction succeeded".
  if (breakParentInstall) pkg.dependencies = { "this-package-definitely-does-not-exist-cw-smoke": "1.0.0" };
  fs.writeFileSync(path.join(dir, "plugins", "cool-workflow", "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  if (!breakParentInstall) {
    spawnSync("npm", ["install", "--package-lock-only", "--silent"], { cwd: path.join(dir, "plugins", "cool-workflow"), encoding: "utf8" });
  }
  fs.mkdirSync(path.join(dir, ".cw-release"), { recursive: true });
  // The pubkey is committed ONCE, well before any given release (RELEASE.md's
  // documented setup step) — by the time a real release happens it already
  // sits in the approved commit's ANCESTRY, not newly added alongside that
  // release's own verdict. Commit it here, as part of R, matching that: a
  // scratch worktree checked out AT R (verify-bump-reproduction.js's
  // reproduction) then already carries it, with no special-casing needed.
  if (committedPubkey) fs.writeFileSync(path.join(dir, ".cw-release", "verdict-signing.pub"), PUB_PEM);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "reviewed content"], dir);
  const R = git(["rev-parse", "HEAD"], dir);

  const verdictPath = path.join(dir, ".cw-release", `review-${R}.verdict`);
  fs.writeFileSync(verdictPath, `APPROVED ${R}\ncap.\n`);
  if (sigFor === "real") fs.writeFileSync(`${verdictPath}.sig`, `${sign(verdictPath)}\n`);
  if (tamperAfterSigning) fs.writeFileSync(verdictPath, `APPROVED ${R}\nTAMPERED.\n`);
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "chore(release): record APPROVED reviewer verdict"], dir);
  const R2 = git(["rev-parse", "HEAD"], dir);
  const HEAD = R2;
  git(["tag", "-a", "v9.9.9", "-m", "v9.9.9"], dir);
  // The fixed bash now reads the pubkey from `origin/main`, not the checked-out
  // tree (the checked-out tree IS the tag under judgment, so it must not be
  // trusted to supply its own pubkey). This fixture has no real remote, so
  // plant a remote-tracking ref by hand at R2 -- exactly where a real repo's
  // origin/main sits right after a normal cut() (bump commit pushed to main,
  // tag placed on that same tip). `git show origin/main:<path>` resolves this
  // ref with no `git remote add` needed (proven with a standalone check).
  // Any later attack commit (replayVerdictOntoBackdoor, forgedHeadVerdict,
  // etc.) is added AFTER this line and must NOT move origin/main -- that is
  // the entire point of the fix: the ref the attacker's own tag commit cannot
  // rewrite.
  git(["update-ref", "refs/remotes/origin/main", R2], dir);

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

/** Simulates the ACTUAL ATTACK verify-bump-reproduction.js exists to close:
 *  copy the already-committed, validly-signed verdict(+sig) for approved
 *  parent R (public git objects — no secret needed) onto a brand-new commit
 *  that is a direct child of R and ALSO smuggles in an arbitrary file. A
 *  plain signature check alone verifies this (it IS a real signature, just
 *  replayed) — only the tree-reproduction check can catch it. Leaves this
 *  new commit checked out (detached HEAD) and tagged "v-attack", separate
 *  from the fixture's own legitimate "v9.9.9" tag on R2. */
function replayVerdictOntoBackdoor(dir, R) {
  const verdictPath = path.join(dir, ".cw-release", `review-${R}.verdict`);
  const sigPath = `${verdictPath}.sig`;
  const verdictBytes = fs.readFileSync(verdictPath);
  const sigBytes = fs.existsSync(sigPath) ? fs.readFileSync(sigPath) : undefined;
  git(["checkout", "-q", "--detach", R], dir);
  fs.writeFileSync(verdictPath, verdictBytes);
  if (sigBytes) fs.writeFileSync(sigPath, sigBytes);
  fs.writeFileSync(path.join(dir, "backdoor.js"), "// malicious payload, never reviewed\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "chore: bump version to 9.9.9 (attacker replay)"], dir);
  const attackSha = git(["rev-parse", "HEAD"], dir);
  git(["tag", "-a", "v-attack", "-m", "attack"], dir);
  return attackSha;
}

/** Replaces the fixture's OWN copy of verify-bump-reproduction.js with a
 *  stub that writes a marker file and exits 1 before doing anything real.
 *  Used to EMPIRICALLY prove the reproduction check is never invoked in a
 *  given scenario (not just by reading the calling bash's structure): if the
 *  overall check still passes AND the marker is absent, the stub was never
 *  called. */
function poisonBumpReproScript(dir) {
  const scriptPath = path.join(dir, "plugins", "cool-workflow", "scripts", "verify-bump-reproduction.js");
  const markerPath = path.join(dir, "bump-repro-invoked.marker");
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "");\nprocess.exit(1);\n`);
  return markerPath;
}

/** Plants a validly-signed verdict directly in the working tree, UNCOMMITTED,
 *  naming it after HEAD's OWN sha — the "verdict matched at the literal tag
 *  commit, not its parent" shape. A commit cannot genuinely contain a file
 *  naming its own sha (the sha is a hash of a tree that would have to already
 *  contain that name), so this mirrors real self-review/local-check usage
 *  (release-flow.js's own --check path validates a verdict for the CURRENT,
 *  not-yet-tagged HEAD) rather than a replay: the check reads the working
 *  tree directly (`[ -f ... ]`/grep), not `git show`. */
function plantVerdictAtLiteralHead(dir, head) {
  const verdictPath = path.join(dir, ".cw-release", `review-${head}.verdict`);
  fs.writeFileSync(verdictPath, `APPROVED ${head}\ncap.\n`);
  fs.writeFileSync(`${verdictPath}.sig`, `${sign(verdictPath)}\n`);
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

// (f) THE ACTUAL ATTACK verify-bump-reproduction.js exists to close: replay
// an already-committed, validly-signed verdict onto an unrelated new commit
// that also smuggles in an arbitrary file. The signature alone verifies (it
// is a REAL signature, just replayed) — only the tree-reproduction check
// catches this.
{
  const { dir, R } = buildFixture({ committedPubkey: true, sigFor: "real" });
  replayVerdictOntoBackdoor(dir, R);
  const r = runScript(gateScript, dir);
  assert.notEqual(r.code, 0, `(f) a replayed verdict on a backdoored commit must be rejected:\n${r.out}`);
  assert.match(r.out, /does not reproduce as its deterministic bump/, "(f) should explain the tree mismatch");
}

// (g) EMPIRICAL proof (not just code-reading) that a verdict matched at the
// LITERAL tag commit (C == SHA) never invokes bump-reproduction at all: it
// should not be needed there (the reviewer approved that exact commit, no
// parent/child gap to bridge), and the reproduction step is comparatively
// expensive (worktree + npm install).
{
  const { dir, HEAD } = buildFixture({ committedPubkey: true, sigFor: "real" });
  const marker = poisonBumpReproScript(dir);
  plantVerdictAtLiteralHead(dir, HEAD);
  const r = runScript(gateScript, dir);
  assert.equal(r.code, 0, `(g) a verdict for the literal tag commit must pass without needing reproduction:\n${r.err}\n${r.out}`);
  assert.ok(!fs.existsSync(marker), "(g) verify-bump-reproduction.js must never be invoked when C == SHA");
}

// (h) EMPIRICAL proof that bump-reproduction is never invoked when no pubkey
// is committed (the grep-only fallback never needs it either).
{
  const { dir } = buildFixture({ committedPubkey: false });
  const marker = poisonBumpReproScript(dir);
  const r = runScript(gateScript, dir);
  assert.equal(r.code, 0, `(h) no-pubkey fallback must pass without needing reproduction:\n${r.err}\n${r.out}`);
  assert.ok(!fs.existsSync(marker), "(h) verify-bump-reproduction.js must never be invoked when no pubkey is committed");
}

// (i) npm install failing (e.g. an unresolvable dependency, standing in for
// any transient registry/infra issue) during REPRODUCTION (i.e. baked into
// the APPROVED PARENT R, which is what the scratch worktree actually checks
// out and installs from) must fail CLOSED — an infrastructure hiccup must
// never be silently treated as "reproduction succeeded".
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: "real", breakParentInstall: true });
  const r = runScript(gateScript, dir);
  assert.notEqual(r.code, 0, `(i) a failing npm install must fail closed, not silently pass:\n${r.out}`);
  assert.match(r.out + r.err, /npm install failed/, "(i) should identify npm install as the failing step");
}

// (j) BUG-1 regression: THE FILENAME-VS-CONTENT REPLAY ATTACK. A verdict
// file's bytes are genuinely, validly signed for sha R — but the file is
// found by FILENAME (`review-<candidate-sha>.verdict`), and the ed25519
// signature only binds the BYTES, never the filename. So copy R's real,
// signed verdict byte-for-byte onto a filename claiming to belong to a brand
// new, never-reviewed commit X (the "malicious tag commit"). The signature
// still verifies (it IS a real signature over these exact bytes). Old
// `grep -q '^APPROVED'` only checks the line STARTS WITH "APPROVED" — it
// never looks at which sha follows, so it would have matched too, and the
// old code would have accepted X as approved. The fix requires the first
// line to read EXACTLY "APPROVED X" for the candidate sha the filename
// itself claims — since the copied content still says "APPROVED R", this
// must be rejected before the signature is even checked.
{
  const { dir, R } = buildFixture({ committedPubkey: true, sigFor: "real" });
  fs.writeFileSync(path.join(dir, "attacker-payload.txt"), "never reviewed\n");
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", "attacker commit, never reviewed"], dir);
  const X = git(["rev-parse", "HEAD"], dir);
  const genuineVerdict = path.join(dir, ".cw-release", `review-${R}.verdict`);
  const genuineSig = `${genuineVerdict}.sig`;
  const wrongShaVerdict = path.join(dir, ".cw-release", `review-${X}.verdict`);
  fs.writeFileSync(wrongShaVerdict, fs.readFileSync(genuineVerdict));
  fs.writeFileSync(`${wrongShaVerdict}.sig`, fs.readFileSync(genuineSig));
  const r = runScript(gateScript, dir);
  assert.notEqual(r.code, 0, `(j) a verdict whose content approves a DIFFERENT sha than its own filename must be rejected:\n${r.out}`);
  assert.match(r.out, /No committed APPROVED verdict/, "(j) should report no valid verdict found for the attacker commit");
}

// (k) BUG-3 regression: the pubkey must come from origin/main, not the
// checked-out tree. Delete the tree's OWN copy of verdict-signing.pub
// (simulating an attacker's tag commit that removes it) — origin/main still
// has it (buildFixture planted that ref at R2, an ancestor-tracking ref the
// tag under judgment cannot rewrite), so an UNSIGNED verdict must still be
// rejected. Old, tree-based PUBKEY resolution would have found no pubkey
// file on disk and silently fallen back to the grep-only, no-signature-
// required path — accepting this.
{
  const { dir } = buildFixture({ committedPubkey: true, sigFor: undefined });
  fs.rmSync(path.join(dir, ".cw-release", "verdict-signing.pub"), { force: true });
  const r = runScript(gateScript, dir);
  assert.notEqual(
    r.code,
    0,
    `(k) deleting the tree's own pubkey copy must not fall back to no-signature-required, since origin/main still has it:\n${r.out}`
  );
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

// (g) THE ACTUAL ATTACK, same as release-gate.yml's (f) above, exercised via
// the workflow_dispatch path with an operator-supplied TAG_REF.
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: "real" });
  replayVerdictOntoBackdoor(fixture.dir, fixture.R);
  const r = runPublishScript(fixture, { TAG_REF: "v-attack" });
  assert.notEqual(r.code, 0, `(g) a replayed verdict on a backdoored commit must be rejected:\n${r.out}`);
  assert.match(r.out, /does not reproduce as its deterministic bump/, "(g) should explain the tree mismatch");
}

// (h) BUG-1 regression, same attack as release-gate.yml's (j) above: a
// verdict file byte-copied from a DIFFERENT (wrong) sha's genuine signed
// verdict, renamed to match a NEW candidate sha, must be rejected even
// though its signature verifies (the same bytes, same signature — just
// parked under the wrong filename).
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: "real" });
  fs.writeFileSync(path.join(fixture.dir, "attacker-payload.txt"), "never reviewed\n");
  git(["add", "-A"], fixture.dir);
  git(["commit", "-q", "-m", "attacker commit, never reviewed"], fixture.dir);
  const X = git(["rev-parse", "HEAD"], fixture.dir);
  const genuineVerdict = path.join(fixture.dir, ".cw-release", `review-${fixture.R}.verdict`);
  const genuineSig = `${genuineVerdict}.sig`;
  const wrongShaVerdict = path.join(fixture.dir, ".cw-release", `review-${X}.verdict`);
  fs.writeFileSync(wrongShaVerdict, fs.readFileSync(genuineVerdict));
  fs.writeFileSync(`${wrongShaVerdict}.sig`, fs.readFileSync(genuineSig));
  git(["tag", "-a", "v-replay", "-m", "replay"], fixture.dir);
  const r = runPublishScript(fixture, { TAG_REF: "v-replay" });
  assert.notEqual(r.code, 0, `(h) a verdict whose content approves a DIFFERENT sha than its own filename must be rejected:\n${r.out}`);
  assert.match(r.out, /No committed APPROVED verdict/, "(h) should report no valid verdict found for the attacker commit");
}

// (i) BUG-3 regression, same as release-gate.yml's (k) above: pubkey must
// come from origin/main, not the checked-out tree.
{
  const fixture = buildFixture({ committedPubkey: true, sigFor: undefined });
  fs.rmSync(path.join(fixture.dir, ".cw-release", "verdict-signing.pub"), { force: true });
  const r = runPublishScript(fixture);
  assert.notEqual(
    r.code,
    0,
    `(i) deleting the tree's own pubkey copy must not fall back to no-signature-required, since origin/main still has it:\n${r.out}`
  );
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

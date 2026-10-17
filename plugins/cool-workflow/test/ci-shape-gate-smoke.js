// ci-shape-gate-smoke — the one-CI-shape gate from
// ~/Developer/sdlc/unify-ci-cd/spec.md section 2, as this GitHub repo's
// version of it (project/docs/sdlc/unify-ci-cd/plan.md, packet C1): plain
// text reads and string asserts over every file in .github/workflows/, no
// YAML library.
//
// This repo differs from the Gitea repos in the spec in two named ways,
// both in the gate itself, not swept under the rug: the LABELS set is
// {ubuntu-latest, macos-latest} (a GitHub-hosted repo, not linux-amd64 /
// macos-arm64), and check 6 drops the "no ubuntu-/macos-latest" ban for the
// same reason. The last part copies the real workflow files into a temp
// dir and checks the gate reports the right fault for one broken copy per
// check.
// @cw-smoke: tags ci,gate
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Repo root is two levels above this plugin dir (plugins/cool-workflow/test -> repo root).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");

const PINS = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "oven-sh/setup-bun": "0c5077e51419868618aeaa5fe8019c62421857d6",
  "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
  "github/codeql-action/init": "24c54180a607b1449ed407dd24f251e4e9147c8d",
  "github/codeql-action/analyze": "24c54180a607b1449ed407dd24f251e4e9147c8d",
  "gitleaks/gitleaks-action": "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
  "actions/upload-pages-artifact": "fc324d3547104276b827a68afc52ff2a11cc49c9",
  "actions/deploy-pages": "368f82528645a54fb793d4d04e342629a3f51346",
};
const LABELS = ["ubuntu-latest", "macos-latest"];
// The ci.yml jobs branch protection requires for merge (AGENTS.md: the
// `check` legs). The release rehearsal must never join this set.
const REQUIRED_JOBS = ["check"];
// The check-run names the release gate takes in place of a local test run
// (scripts/release-ci-checks.mjs, the one list). Each must be a leg of the
// ci.yml `check` job: "check (<node-version>)".
const { REQUIRED_CHECKS } = require("../scripts/release-ci-checks.mjs");
const REHEARSAL_JOB = "release-rehearsal";
const EXCEPTIONS = ["codeql.yml", "gitleaks.yml", "pages.yml", "npm-publish.yml"];
// GITHUB_TOKEN too: on Gitea it is empty in schedule and dispatch runs; write github.token.
const BANNED_TOKENS = ["CT_GITEA_TOKEN", "CI_VENDOR_TOKEN", "AUTOMERGE_TOKEN", "RENOVATE_TOKEN", "GITHUB_TOKEN"];

/** The text of one top-level job under jobs: in a workflow, or "" when absent. */
function jobBlock(text, id) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${id}:`);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:/.test(lines[end]) && !/^\S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

/** Every fault the gate finds in one .github/workflows/ directory, as strings. */
function gate(workflowsDir, repoRoot) {
  const faults = [];

  // 1. no .gitea/workflows/ directory
  if (fs.existsSync(path.join(repoRoot, ".gitea", "workflows"))) {
    faults.push(".gitea/workflows/ must not exist");
  }

  if (!fs.existsSync(workflowsDir)) return faults;
  const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"));
  const allowed = new Set(["ci.yml", "release.yml", "scheduled.yml", ...EXCEPTIONS]);

  const textByFile = new Map();
  for (const file of files) {
    // 2. file names restricted to the fixed three plus named exceptions
    if (!allowed.has(file)) faults.push(`${file}: not one of the fixed names or a named exception`);

    const text = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    textByFile.set(file, text);

    // 4. every runs-on: value in LABELS
    for (const m of text.matchAll(/runs-on:\s*(\S+)/g)) {
      if (!LABELS.includes(m[1])) faults.push(`${file}: runs-on ${m[1]} not in ${LABELS.join("/")}`);
    }

    // 5. every uses: line is action@40-hex-sha # vX, and the SHA is pinned
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) {
      const usesLine = m[1];
      const usesMatch = usesLine.match(/^([^@]+)@([0-9a-f]{40})$/);
      const lineEnd = text.slice(m.index).split("\n")[0];
      if (!usesMatch || !/# v/.test(lineEnd)) {
        faults.push(`${file}: uses line does not match action@<40-hex-sha> # vX: ${usesLine}`);
        continue;
      }
      const [, action, sha] = usesMatch;
      if (PINS[action] !== sha) faults.push(`${file}: ${action} pinned to ${sha}, not in the pin table`);
    }

    // 6. no gitea., no hashFiles( — the ubuntu-/macos-latest ban is dropped
    //    here (spec item 6): this repo is GitHub-hosted, and check 4 above
    //    already restricts runs-on to the GitHub label set.
    if (/gitea\./.test(text)) faults.push(`${file}: contains "gitea."`);
    if (/hashFiles\(/.test(text)) faults.push(`${file}: contains "hashFiles("`);

    // 7. none of the retired token aliases
    for (const t of BANNED_TOKENS) {
      if (text.includes(`secrets.${t}`)) faults.push(`${file}: uses retired secrets.${t}`);
    }
  }

  // 3. ci.yml has a job id `check`
  if (!/^\s{2}check:/m.test(textByFile.get("ci.yml") || "")) faults.push("ci.yml: no job id \"check\"");

  // 8. ci.yml has the release-rehearsal job: not a required check, every
  //    action pinned by full SHA, gated by a changed-files step, run on the
  //    bundled and the newest npm, with the stub reviewer and no key.
  const rehearsal = jobBlock(textByFile.get("ci.yml") || "", REHEARSAL_JOB);
  if (!rehearsal) {
    faults.push(`ci.yml: no job id "${REHEARSAL_JOB}"`);
  } else {
    if (REQUIRED_JOBS.includes(REHEARSAL_JOB) || /^\s{4}name:\s*["']?check\b/m.test(rehearsal)) {
      faults.push(`ci.yml: ${REHEARSAL_JOB} must not be a required check`);
    }
    const uses = [...rehearsal.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    if (!uses.length) faults.push(`ci.yml: ${REHEARSAL_JOB} uses no actions`);
    for (const u of uses) {
      const m = u.match(/^([^@]+)@([0-9a-f]{40})$/);
      if (!m || PINS[m[1]] !== m[2]) faults.push(`ci.yml: ${REHEARSAL_JOB} action not pinned by full SHA: ${u}`);
    }
    if (!/^\s+- id: changed$/m.test(rehearsal)) faults.push(`ci.yml: ${REHEARSAL_JOB} has no changed-files step`);
    if (!/npm:\s*\["bundled",\s*"latest"\]/.test(rehearsal)) {
      faults.push(`ci.yml: ${REHEARSAL_JOB} does not run on the bundled and the latest npm`);
    }
    if (!/release-flow\.mjs --check/.test(rehearsal)) faults.push(`ci.yml: ${REHEARSAL_JOB} does not run release-flow.mjs --check`);
    // The rehearsal runs beside the required checks, so it cannot wait on
    // them: it must run the gate's test step locally.
    if (!/^\s+- run: node scripts\/release-flow\.mjs --check --local-tests$/m.test(rehearsal)) faults.push(`ci.yml: ${REHEARSAL_JOB} must run release-flow.mjs --check --local-tests`);
    if (!/CW_AGENT_COMMAND:.*test\/fixtures\/release-rehearsal-reviewer\.js \{\{input\}\}/.test(rehearsal)) {
      faults.push(`ci.yml: ${REHEARSAL_JOB} reviewer is not the committed stub`);
    }
    if (/CW_RELEASE_VERDICT_PRIVKEY|--push|npm publish|secrets\./.test(rehearsal)) {
      faults.push(`ci.yml: ${REHEARSAL_JOB} must hold no signing key and never push or publish`);
    }
  }

  // 9. every check the release gate requires is a leg of the `check` matrix
  const checkJob = jobBlock(textByFile.get("ci.yml") || "", "check");
  const nodeMatrix = (checkJob.match(/node-version:\s*\[([^\]]*)\]/) || [, ""])[1]
    .split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  for (const name of REQUIRED_CHECKS) {
    const m = name.match(/^check \((.+)\)$/);
    if (!m || !nodeMatrix.includes(m[1])) faults.push(`ci.yml: release required check "${name}" is not a leg of the check job`);
  }

  // 3. release.yml has no cancel-in-progress: true
  if (/cancel-in-progress:\s*true/.test(textByFile.get("release.yml") || "")) {
    faults.push("release.yml: cancel-in-progress: true would drop a queued gate run");
  }

  return faults;
}

const liveFaults = gate(WORKFLOWS, REPO_ROOT);
assert.deepStrictEqual(liveFaults, [], `the live .github/workflows/ must pass the CI-shape gate; faults:\n${liveFaults.join("\n")}`);

// ---- bite proof: one planted fault per check, each must go red ----------
function tmpWorkflowsCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ci-shape-gate-"));
  const dir = path.join(root, ".github", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(WORKFLOWS)) {
    fs.copyFileSync(path.join(WORKFLOWS, f), path.join(dir, f));
  }
  return { root, dir };
}

function withFault(mutate, expectSubstring) {
  const { root, dir } = tmpWorkflowsCopy();
  mutate(dir, root);
  const faults = gate(dir, root);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(
    faults.some((f) => f.includes(expectSubstring)),
    `planted fault must be caught (expected a fault containing "${expectSubstring}"); got:\n${faults.join("\n")}`
  );
}

// 1. a stray .gitea/workflows/ directory
withFault((_dir, root) => fs.mkdirSync(path.join(root, ".gitea", "workflows"), { recursive: true }), ".gitea/workflows");

// 2. a file name outside the fixed three + exceptions
withFault((dir) => fs.writeFileSync(path.join(dir, "bench.yml"), "name: bench\non: push\njobs: {}\n"), "not one of the fixed names");

// 3a. ci.yml's job id renamed away from `check`
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/^\s{2}check:/m, "  cool-workflow:"));
}, 'no job id "check"');

// 3b. release.yml with cancel-in-progress: true
withFault((dir) => {
  const p = path.join(dir, "release.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("cancel-in-progress: false", "cancel-in-progress: true"));
}, "cancel-in-progress: true would drop");

// 4. a runs-on value outside the label set
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("runs-on: macos-latest", "runs-on: macos-arm64"));
}, "not in ubuntu-latest/macos-latest");

// 5. a uses: line pinned to a SHA not in the table
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "actions/checkout@0000000000000000000000000000000000000000 # v7.0.1"
    )
  );
}, "not in the pin table");

// 6a. a "gitea." reference
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8") + "\n# ${{ gitea.ref }}\n");
}, 'contains "gitea."');

// 6b. a hashFiles( call
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8") + "\n# ${{ hashFiles('x') }}\n");
}, 'contains "hashFiles("');

// 7. a retired token alias
withFault((dir) => {
  const p = path.join(dir, "scheduled.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8") + "\n# ${{ secrets.CT_GITEA_TOKEN }}\n");
}, "retired secrets.CT_GITEA_TOKEN");

// 8a. the release-rehearsal job removed
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  const text = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, `${text.slice(0, text.indexOf("\n  release-rehearsal:"))}\n`);
}, 'no job id "release-rehearsal"');

// 8b. a rehearsal action pinned by tag, not by SHA
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  const text = fs.readFileSync(p, "utf8");
  const at = text.indexOf("\n  release-rehearsal:");
  fs.writeFileSync(p, text.slice(0, at) + text.slice(at).replace(/actions\/setup-node@[0-9a-f]{40}/, "actions/setup-node@v7"));
}, "release-rehearsal action not pinned by full SHA");

// 8c. the rehearsal given the required check's name
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("  release-rehearsal:\n", "  release-rehearsal:\n    name: check\n"));
}, "must not be a required check");

// 8d. the latest-npm leg dropped
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace('npm: ["bundled", "latest"]', 'npm: ["bundled"]'));
}, "bundled and the latest npm");

// 8e. the rehearsal waiting on the CI checks it runs beside
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("- run: node scripts/release-flow.mjs --check --local-tests", "- run: node scripts/release-flow.mjs --check"));
}, "must run release-flow.mjs --check --local-tests");

// 9. a required release check whose Node leg was dropped from the matrix
withFault((dir) => {
  const p = path.join(dir, "ci.yml");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace('node-version: ["22", "24"]', 'node-version: ["22"]'));
}, 'release required check "check (24)" is not a leg');

console.log("ci-shape-gate-smoke: ok");

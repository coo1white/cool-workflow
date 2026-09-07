// ci-shape-gate-smoke — the one-CI-shape gate from
// ~/Developer/sdlc/unify-ci-cd/spec.md section 2, as this GitHub repo's
// version of it (sdlc/unify-ci-cd/plan.md, packet C1): plain text reads and
// string asserts over every file in .github/workflows/, no YAML library.
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
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
  "github/codeql-action/init": "cdf488f595d80d6e07e03d4674febd5ab45fa938",
  "github/codeql-action/analyze": "cdf488f595d80d6e07e03d4674febd5ab45fa938",
  "gitleaks/gitleaks-action": "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
  "actions/upload-pages-artifact": "fc324d3547104276b827a68afc52ff2a11cc49c9",
  "actions/deploy-pages": "368f82528645a54fb793d4d04e342629a3f51346",
};
const LABELS = ["ubuntu-latest", "macos-latest"];
const EXCEPTIONS = ["codeql.yml", "gitleaks.yml", "pages.yml", "npm-publish.yml"];
// GITHUB_TOKEN too: on Gitea it is empty in schedule and dispatch runs; write github.token.
const BANNED_TOKENS = ["CT_GITEA_TOKEN", "CI_VENDOR_TOKEN", "AUTOMERGE_TOKEN", "RENOVATE_TOKEN", "GITHUB_TOKEN"];

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

console.log("ci-shape-gate-smoke: ok");

"use strict";
// growth-budget-check-smoke — proves the growth-budget gate has teeth.
//
// The gate is scripts/growth-budget-check.js (`npm run growth:check`). This
// smoke:
//   1. positive — the check PASSES on the real committed tree.
//   2. teeth    — the check FAILS closed (exit 1) once a fixture repo goes
//                 over either ceiling.
// The teeth case points the check at a throwaway git repo via CW_GROWTH_ROOT
// + CW_GROWTH_BUDGET_FILE, so the real tracked tree is never touched.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const script = path.join(pluginRoot, "scripts", "growth-budget-check.js");

function run(env) {
  return cp.spawnSync(process.execPath, [script], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function git(args, cwd) {
  cp.execFileSync("git", args, { cwd, stdio: "pipe" });
}

// 1. positive: the committed tree must be within budget. If this fails, the
//    tree grew past manifest/growth-budget.json -- slim first, see that file.
{
  const r = run({});
  assert.equal(r.status, 0, `growth:check must PASS on the real tree. exit=${r.status}\n${r.stderr}`);
  assert.ok(/within budget/.test(r.stdout), `pass output must say so, got: ${r.stdout}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-growth-"));
try {
  git(["init", "-q"], tmp);
  git(["config", "user.email", "test@example.com"], tmp);
  git(["config", "user.name", "test"], tmp);

  fs.mkdirSync(path.join(tmp, "plugins", "cool-workflow", "src"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "a.md"), "# a\n");
  fs.writeFileSync(path.join(tmp, "b.md"), "# b\n");
  fs.writeFileSync(
    path.join(tmp, "plugins", "cool-workflow", "src", "x.ts"),
    "// one\n// two\n// three\nexport {};\n"
  );
  git(["add", "-A"], tmp);
  git(["commit", "-q", "-m", "fixture"], tmp);

  const budgetFile = path.join(tmp, "growth-budget.json");
  fs.writeFileSync(
    budgetFile,
    JSON.stringify({
      trackedMarkdownFiles: { maxCount: 1 },
      srcCommentLines: { maxCount: 100 }
    })
  );

  // 2. teeth: 2 tracked .md files against a maxCount of 1 must fail closed,
  //    and the failure must name the offending count and the ceiling.
  const r = run({ CW_GROWTH_ROOT: tmp, CW_GROWTH_BUDGET_FILE: budgetFile });
  assert.equal(r.status, 1, `must FAIL over budget. exit=${r.status}\n${r.stdout}`);
  assert.ok(/tracked \.md files: 2 > 1/.test(r.stderr), `failure must name the count, got: ${r.stderr}`);
  assert.ok(/slim/.test(r.stderr), `failure must say to slim first, got: ${r.stderr}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("growth-budget-check-smoke: PASS\n");

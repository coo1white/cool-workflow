"use strict";
// growth-budget-check-smoke — proves the growth-budget gate has teeth.
//
// The gate is scripts/growth-budget-check.js (`npm run growth:check`). This
// smoke: 1. positive on the real tree, pass line names the frozen count.
// 2. teeth: fixture over the .md ceiling fails closed. 3. frozen teeth:
// fixture path one line over its own ceiling fails closed. The teeth cases
// point at a throwaway git repo via CW_GROWTH_ROOT + CW_GROWTH_BUDGET_FILE,
// so the real tracked tree is never touched.

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
  assert.ok(/frozen=\d+ paths within ceiling/.test(r.stdout), `pass output must name the frozen count, got: ${r.stdout}`);
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

  // 3. frozen teeth: the fixture's ts file above is 4 tracked lines; a
  //    ceiling of 3 puts it one line over, and the failure must name the path.
  const frozenBudgetFile = path.join(tmp, "growth-budget-frozen.json");
  fs.writeFileSync(
    frozenBudgetFile,
    JSON.stringify({
      trackedMarkdownFiles: { maxCount: 10 },
      srcCommentLines: { maxCount: 100 },
      frozenPaths: [{ path: "plugins/cool-workflow/src/x.ts", maxLines: 3 }]
    })
  );
  const rf = run({ CW_GROWTH_ROOT: tmp, CW_GROWTH_BUDGET_FILE: frozenBudgetFile });
  assert.equal(rf.status, 1, `must FAIL over a frozen ceiling. exit=${rf.status}\n${rf.stdout}`);
  assert.ok(/frozen plugins\/cool-workflow\/src\/x\.ts: 4 > 3/.test(rf.stderr), `failure must name the frozen path, got: ${rf.stderr}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("growth-budget-check-smoke: PASS\n");

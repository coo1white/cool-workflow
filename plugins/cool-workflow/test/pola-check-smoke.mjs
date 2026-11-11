// pola-check-smoke — proves scripts/pola-check.mjs (`npm run pola:check`)
// has teeth. Every case runs against a throwaway git repo (CW_POLA_ROOT), so
// the real tree is never touched. The repo has a release tag cut the way
// release-flow cuts one: a one-hop verdict leaf on the reviewed commit.

import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(pluginRoot, "scripts", "pola-check.mjs");
const PKG = "plugins/cool-workflow/package.json";
const INTENT = "plugins/cool-workflow/project/docs/intent";
const CASE = "v2/conformance/cases/help.case.mjs";
const FIXTURE = "v2/conformance/cases/fixtures/cli-help/_root.txt";
const RUN_A = "plugins/cool-workflow/test/fixtures/runs/run-a/state.json";
const RUN_B = "plugins/cool-workflow/test/fixtures/runs/run-b/state.json";

function git(args, cwd) {
  return cp.execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

function run(root, args = []) {
  return cp.spawnSync(process.execPath, [script, ...args], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: { ...process.env, CW_POLA_ROOT: root }
  });
}

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function setVersion(root, version) {
  write(root, PKG, `${JSON.stringify({ name: "cool-workflow", version }, null, 2)}\n`);
}

function record(root, heading, body) {
  write(root, `${INTENT}/2026-11-03-x.md`, `# Intent\n\n## ${heading}\n\n${body}\n\n## Later part\n\nNot this section: ${CASE}\n`);
}

function reset(root) {
  git(["reset", "-q", "--hard"], root);
  git(["clean", "-fdq"], root);
}

function initRepo() {
  const root = tmpDir("cw-pola-");
  git(["init", "-q", "-b", "main"], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "user.name", "test"], root);
  return root;
}

const root = initRepo();
setVersion(root, "0.1.0");
write(root, CASE, "assert.equal(out, 'old');\n");
write(root, FIXTURE, "Cool Workflow\n  old row\n");
write(root, RUN_A, "{\"a\":1}\n");
write(root, RUN_B, "{\"b\":1}\n");
write(root, `${INTENT}/README.md`, "# Intent\n");
git(["add", "-A"], root);
git(["commit", "-q", "-m", "reviewed"], root);
// An older tag that sorts first by text but last by semver.
git(["tag", "v0.0.10"], root);
// The verdict leaf: a commit on top of the reviewed one, tagged, never on
// main. It also edits the fixture, so a check that diffed against the tag
// itself (not tag^1) would see FIXTURE as changed on a clean main.
git(["checkout", "-q", "--detach"], root);
write(root, ".cw-release/review.verdict", "APPROVED\n");
write(root, FIXTURE, "Cool Workflow\n  leaf only\n");
git(["add", "-A"], root);
git(["commit", "-q", "-m", "verdict"], root);
git(["tag", "v0.1.0"], root);
git(["checkout", "-q", "main"], root);

// 1. Clean tree: silent, exit 0 (base is v0.1.0^1, not the leaf).
{
  const r = run(root);
  assert.equal(r.status, 0, `clean tree must pass: ${r.stderr}`);
  assert.equal(r.stdout, "", "silent on success (stdout)");
  assert.equal(r.stderr, "", "silent on success (stderr)");
  const j = JSON.parse(run(root, ["--json"]).stdout);
  assert.equal(j.base.tag, "v0.1.0", "newest tag by semver, not by text");
  assert.equal(j.base.commit, git(["rev-parse", "v0.1.0^1"], root).trim(), "base is the tag's first parent");
  assert.deepEqual(j.pins, []);
}

// 2. An ADDED fixture is new surface: passes with no raise and no record.
{
  write(root, "v2/conformance/cases/fixtures/cli-help/check.txt", "new page\n");
  write(root, "v2/conformance/cases/new.case.mjs", "// new\n");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "add pins"], root);
  const r = run(root);
  assert.equal(r.status, 0, `an added pin must pass: ${r.stderr}`);
  assert.equal(r.stderr, "");
  git(["reset", "-q", "--hard", "HEAD~1"], root);
}

// 3. A modified pin with the version not raised fails (POLA condition 3),
//    even with a record in place.
{
  write(root, CASE, "assert.equal(out, 'new');\n");
  record(root, "Operator decisions for 0.1.0 (2026-11-03)", `Yes. Pin: ${CASE}. Said in doctor.7.md.`);
  const r = run(root);
  assert.equal(r.status, 1, "a changed pin with no version raise must fail");
  assert.match(r.stderr, /help\.case\.mjs is modified since v0\.1\.0, but .*package\.json is still 0\.1\.0/);
  assert.equal(r.stdout, "", "faults go to stderr only");
  const j = JSON.parse(run(root, ["--json"]).stdout);
  assert.equal(j.ok, false);
  assert.deepEqual(j.faults.map((f) => [f.pin, f.fault]), [[CASE, "version-not-raised"]]);
  reset(root);
}

// 4. Raised version, no record: fails and says what to do.
{
  setVersion(root, "0.1.1");
  write(root, CASE, "assert.equal(out, 'new');\n");
  const r = run(root);
  assert.equal(r.status, 1, "a changed pin with no record must fail");
  assert.match(r.stderr, /no "Operator decisions for 0\.1\.1" section/);
  assert.match(r.stderr, /Ask the owner, quoting the old and the new text/);
  assert.match(r.stderr, /docs\/\*\.7\.md/);

  // A record that names only a DIFFERENT pin, or names this pin outside
  // the section, still fails.
  record(root, "Operator decisions for 0.1.1 (2026-11-03)", `Yes. Pin: ${FIXTURE}. Said in doctor.7.md.`);
  assert.equal(run(root).status, 1, "naming another pin is no record for this one");

  // A section for a longer version (0.1.10) is not a record for 0.1.1.
  record(root, "Operator decisions for 0.1.10 (2026-11-03)", `Yes. Pin: ${CASE}. Said in doctor.7.md.`);
  assert.equal(run(root).status, 1, "0.1.10 must not match 0.1.1");

  // A name that only contains the pin's name is not the pin's name.
  record(root, "Operator decisions for 0.1.1 (2026-11-03)", "Yes. Pin: oldhelp.case.mjs. Said in doctor.7.md.");
  assert.equal(run(root).status, 1, "oldhelp.case.mjs does not name help.case.mjs");

  // Named, but no man page in the section: fails.
  record(root, "Operator decisions for 0.1.1 (2026-11-03)", `Yes. Pin: ${CASE}.`);
  const noMan = run(root);
  assert.equal(noMan.status, 1, "a record with no man page must fail");
  assert.match(noMan.stderr, /names no docs\/\*\.7\.md/);

  // Named by file name, man page named: passes, silent.
  record(root, "Operator decisions for 0.1.1, named (2026-11-03)", "Yes. Pin: `help.case.mjs`. Said in doctor.7.md.");
  const ok = run(root);
  assert.equal(ok.status, 0, `a full record must pass: ${ok.stderr}`);
  assert.equal(ok.stderr, "");
  assert.equal(ok.stdout, "");
  const j = JSON.parse(run(root, ["--json"]).stdout);
  assert.equal(j.ok, true);
  assert.match(j.pins[0].record, /2026-11-03-x\.md: Operator decisions for 0\.1\.1, named/);
  reset(root);
}

// 5. A deleted pin is a change; a file name shared by two pins must be
//    named by a longer path end.
{
  setVersion(root, "0.2.0");
  fs.rmSync(path.join(root, RUN_A));
  record(root, "Operator decisions for 0.2.0", "Yes. Pin: `state.json`. Said in release-and-migration.7.md.");
  const r = run(root);
  assert.equal(r.status, 1, "state.json alone names two pins, so it names neither");
  assert.match(r.stderr, /run-a\/state\.json is deleted since v0\.1\.0/);
  record(root, "Operator decisions for 0.2.0", "Yes. Pin: `run-a/state.json`. Said in release-and-migration.7.md.");
  assert.equal(run(root).status, 0, "run-a/state.json names the one pin");
  reset(root);

  // A rename is a delete of the old path (plus an add, which is free).
  fs.mkdirSync(path.join(root, "plugins/cool-workflow/test/fixtures/runs/run-c"));
  git(["mv", RUN_B, "plugins/cool-workflow/test/fixtures/runs/run-c/state.json"], root);
  const moved = JSON.parse(run(root, ["--json"]).stdout);
  assert.deepEqual(moved.faults.map((f) => [f.pin, f.status]), [[RUN_B, "deleted"]]);
  reset(root);
}

// 6. No release tag: refuses (fail closed), in text and in --json.
{
  const bare = initRepo();
  setVersion(bare, "0.1.0");
  git(["add", "-A"], bare);
  git(["commit", "-q", "-m", "first"], bare);
  const r = run(bare);
  assert.equal(r.status, 1, "no tag must fail closed");
  assert.match(r.stderr, /refused: no vX\.Y\.Z release tag found/);
  const j = run(bare, ["--json"]);
  assert.equal(j.status, 1);
  assert.equal(JSON.parse(j.stdout).ok, false);
}

// 7. Shallow clone that has the tag but not its reviewed commit: refuses.
{
  const shallow = tmpDir("cw-pola-shallow-");
  git(["clone", "-q", "--depth", "1", `file://${root}`, shallow], pluginRoot);
  git(["fetch", "-q", "--depth", "1", "origin", "tag", "v0.1.0"], shallow);
  const r = run(shallow);
  assert.equal(r.status, 1, "a shallow clone without tag^1 must fail closed");
  assert.match(r.stderr, /v0\.1\.0\^1\) is not in this clone \(it is a shallow clone\)/);
}

// 8. Line level: every changed line of a captured text pin must be quoted,
//    word for word, in an "Operator decisions for <version>" section.
//    Naming the path and a man page is not enough for these.
{
  setVersion(root, "0.1.1");
  write(root, FIXTURE, "Cool Workflow\n  new row|check\n\n  second new\n");
  record(root, "Operator decisions for 0.1.1", "Yes. Pin: `_root.txt`. Said in doctor.7.md.");
  const r = run(root);
  assert.equal(r.status, 1, "a changed fixture line that no section quotes must fail");
  assert.match(r.stderr, /cli-help\/_root\.txt has a changed line that no "Operator decisions for 0\.1\.1" section quotes word for word: "new row\|check"/);
  assert.match(r.stderr, /"second new"/);
  const j = JSON.parse(run(root, ["--json"]).stdout);
  assert.deepEqual(
    j.faults.map((f) => [f.pin, f.fault, f.line]),
    [[FIXTURE, "line-not-quoted", "new row|check"], [FIXTURE, "line-not-quoted", "second new"]],
    "one fault per changed line; the blank added line is not counted"
  );
  assert.equal(j.pins[0].lines, 2);

  // Quoted with other spaces around it (trimmed) in one section, the other
  // line in a second section for the same version: the union passes.
  write(
    root,
    `${INTENT}/2026-11-03-x.md`,
    "# Intent\n\n## Operator decisions for 0.1.1\n\nYes to 「  new row|check」. Pin: `_root.txt`. Said in doctor.7.md.\n\n" +
      "### Operator decisions for 0.1.1, more\n\nYes to `second new`.\n"
  );
  const ok = run(root);
  assert.equal(ok.status, 0, `every line quoted across the sections must pass: ${ok.stderr}`);
  assert.equal(ok.stderr, "");

  // The line quoted only OUTSIDE a decisions section does not count.
  write(
    root,
    `${INTENT}/2026-11-03-x.md`,
    "# Intent\n\n## Operator decisions for 0.1.1\n\nYes to 「new row|check」. Pin: `_root.txt`. Said in doctor.7.md.\n\n" +
      "## Later part\n\nsecond new\n"
  );
  const outside = JSON.parse(run(root, ["--json"]).stdout);
  assert.deepEqual(outside.faults.map((f) => f.line), ["second new"], "a quote outside the section is no quote");
  reset(root);

  // A case .mjs keeps the path rule only: its changed assert line need not
  // be quoted, so naming it with a man page passes.
  setVersion(root, "0.1.1");
  write(root, CASE, "assert.equal(out, 'quite new');\n");
  record(root, "Operator decisions for 0.1.1", "Yes. Pin: `help.case.mjs`. Said in doctor.7.md.");
  const code = run(root);
  assert.equal(code.status, 0, `a case .mjs is held by path, not line: ${code.stderr}`);
  reset(root);

  // A run-state fixture is captured data, so it is held line by line too.
  setVersion(root, "0.1.1");
  write(root, RUN_A, "{\"a\":2}\n");
  record(root, "Operator decisions for 0.1.1", "Yes. Pin: `run-a/state.json`. Said in release-and-migration.7.md.");
  const state = JSON.parse(run(root, ["--json"]).stdout);
  assert.deepEqual(state.faults.map((f) => [f.fault, f.line]), [["line-not-quoted", "{\"a\":2}"]]);
  reset(root);
}

// 9. Promise lines (batch B1 of the 2026-11-11 intent): each line of a
//    ```promise block in an "Operator decisions for <version>" section must
//    be held, as plain text, by a line under plugins/cool-workflow/test/ or
//    v2/conformance/. <name> stands for any text. The 0.4.1 cut was turned
//    back twice for a text other than the one the yes quoted; this makes
//    that a PR CI fault.
{
  const TEST = "plugins/cool-workflow/test/doctor-smoke.mjs";
  const promise = (lines) =>
    record(root, "Operator decisions for 0.1.1", "Yes, word for word.\n\n```promise\n" + lines.join("\n") + "\n```");
  setVersion(root, "0.1.1");
  promise(["leftover branch <name> — <reason>; the cut stage would reset it"]);
  const none = run(root);
  assert.equal(none.status, 1, "a promise no test holds must fail");
  assert.match(
    none.stderr,
    /promise line "leftover branch <name> — <reason>; the cut stage would reset it" in "Operator decisions for 0\.1\.1" \(.*2026-11-03-x\.md\) is held by no line under plugins\/cool-workflow\/test\/ or v2\/conformance\//
  );
  const j = JSON.parse(run(root, ["--json"]).stdout);
  assert.deepEqual(j.faults.map((f) => [f.fault, f.line]), [["promise-not-held", "leftover branch <name> — <reason>; the cut stage would reset it"]]);
  assert.equal(j.promises[0].heldBy, null);

  // A test that asserts another text does not hold it.
  write(root, TEST, "assert.match(err, 'leftover branch x — it holds old code; not removed for you');\n");
  assert.equal(run(root).status, 1, "a different text is not the promise");

  // A test that asserts the promised text (placeholders filled) holds it.
  write(root, TEST, "assert.ok(err.includes(\"leftover branch release/v0.1.1-cut — a commit; the cut stage would reset it\"));\n");
  const held = run(root);
  assert.equal(held.status, 0, `a held promise passes: ${held.stderr}`);
  assert.equal(held.stderr, "");
  assert.equal(JSON.parse(run(root, ["--json"]).stdout).promises[0].heldBy, `${TEST}:1`);

  // Escaped quotes in a JS string still hold a promise with quotes; a v2
  // fixture line holds one too.
  promise(['say "yes" now', "  new row|check"]);
  write(root, TEST, 'assert.equal(out, "say \\"yes\\" now");\n');
  write(root, FIXTURE, "Cool Workflow\n  old row\n  new row|check\n");
  const two = JSON.parse(run(root, ["--json"]).stdout);
  assert.deepEqual(two.promises.map((p) => p.heldBy), [`${TEST}:1`, `${FIXTURE}:3`]);
  reset(root);

  // A section for a longer version (0.1.10) is not checked for 0.1.1.
  setVersion(root, "0.1.1");
  record(root, "Operator decisions for 0.1.10", "```promise\nnever held\n```");
  assert.equal(run(root).status, 0, "0.1.10 promises are not 0.1.1 promises");
  reset(root);
}

// 10. The change sheet (batch B2): --sheet lists each string literal added
//     or taken out under src/ and scripts/ since the base, on stdout, exit 0.
//     It is a list to read, not a gate. Comments and import paths are left
//     out; dist/ is not listed (it is the build of src/).
{
  const SRC = "plugins/cool-workflow/src/shell/doctor.ts";
  const SCRIPT = "plugins/cool-workflow/scripts/release-doctor.mjs";
  const DIST = "plugins/cool-workflow/dist/shell/doctor.js";
  write(root, SRC, 'import { x } from "./x.js";\nexport const a = "same text";\nexport const b = "old line";\n');
  write(root, SCRIPT, "const c = 'kept';\n");
  write(root, DIST, 'const b = "old line";\n');
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "sources"], root);
  // A new base, so the sources above are in it: tag a verdict leaf again.
  git(["checkout", "-q", "--detach"], root);
  write(root, ".cw-release/review2.verdict", "APPROVED\n");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "verdict 2"], root);
  git(["tag", "v0.1.1"], root);
  git(["checkout", "-q", "main"], root);
  setVersion(root, "0.1.1");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "version"], root);

  write(root, SRC, 'import { x } from "./y.js";\nexport const a = "same text";\n// a "comment" string\nexport const b = "new line";\n');
  write(root, SCRIPT, "const c = 'kept';\nconst d = `added — ${c}`;\n");
  write(root, DIST, 'const b = "new line";\n');
  const r = run(root, ["--sheet"]);
  assert.equal(r.status, 0, `the sheet is not a gate: ${r.stderr}`);
  assert.equal(r.stderr, "");
  assert.equal(
    r.stdout,
    "pola:check sheet: string literals changed since v0.1.1^1 (2 file(s)).\n" +
      `${SCRIPT}:2\n` +
      "  + `added — ${c}`\n" +
      `${SRC}:4\n` +
      '  - "old line"\n' +
      '  + "new line"\n'
  );
  const j = JSON.parse(run(root, ["--sheet", "--json"]).stdout);
  assert.deepEqual(j.base.tag, "v0.1.1");
  assert.deepEqual(j.sheet, [
    { path: SCRIPT, line: 2, removed: [], added: ["`added — ${c}`"] },
    { path: SRC, line: 4, removed: ['"old line"'], added: ['"new line"'] }
  ]);
  // Nothing changed: one line that says so.
  reset(root);
  assert.equal(run(root, ["--sheet"]).stdout, "pola:check sheet: no string literal changed since v0.1.1^1.\n");
}

process.stdout.write("pola-check smoke: ok\n");

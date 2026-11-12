#!/usr/bin/env node

// cw doctor — read-only host checks. Fixed check order (node, agent, git,
// repo-state, run-state-integrity — agent-binary / agent-runs only fire
// for a configured or detected agent), fixed glyphs and summary strings,
// --json shape, and the read-only invariant (it never creates <cwd>/.cw).
// The sandbox-enforceability, home-registry and audit-integrity checks went
// with their surfaces in batch 5 (2026-11-12).

import fs from "node:fs";
import path from "node:path";
import { run, freshDir, caseMain, assert } from "../lib.mjs";

// A PATH with only node's folder on it (no git) and auto-detect off (no
// agent) forces deterministic agent=warn + git=warn checks.
const ENV = { PATH: path.dirname(process.execPath), CW_NO_AUTO_AGENT: "1" };

caseMain(() => {
  const cwd = freshDir("cwd");

  // --- human text, warn path (no agent, no git) ---
  const human = run(["doctor"], { cwd, env: ENV });
  assert.equal(human.status, 0, "warnings alone must not fail the exit code");
  assert.equal(human.stderr, "");
  assert.match(human.stdout, /^cw doctor\n/);
  assert.match(human.stdout, / {2}✓ node: Node v\d+\.\d+\.\d+ \(>= 22\.13\)\.\n/);
  assert.match(
    human.stdout,
    / {2}! agent: No agent backend configured — `cw demo tamper` and `cw check` work, but a real run reports status: blocked\.\n/
  );
  assert.match(
    human.stdout,
    / {6}fix: Install an agent CLI such as Claude Code, then add -claude to your cw command, for one: cw -q "your question" -claude \(or set CW_AGENT_COMMAND=builtin:claude\)\. -codex, -gemini and -opencode work too\.\n/
  );
  assert.match(human.stdout, / {2}! git: git is not available/);
  assert.match(human.stdout, / {2}✓ repo-state: Run state location is writable \(.*\)\.\n/);
  assert.match(human.stdout, / {2}✓ run-state-integrity: No runs under \.cw\/runs yet\.\n/);
  assert.match(human.stdout, /\n✓ ready, with 2 warnings\n/);
  assert.match(human.stdout, /\nQuick start:\n {2}1\. cw demo tamper .*\n {2}2\. cw check -- npm test .*\n {2}3\. cw -q "what risks\?" .*\n$/);

  // --- --json, same warn scenario ---
  const json = run(["doctor", "--json"], { cwd, env: ENV });
  assert.equal(json.status, 0);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(report), ["schemaVersion", "ok", "checks", "summary"]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  assert.equal(report.summary, "ready, with 2 warnings");
  assert.deepEqual(report.checks.map((c) => c.name), ["node", "agent", "git", "repo-state", "run-state-integrity"]);
  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
  assert.equal(byName.node.status, "ok");
  assert.equal(byName.node.fix, undefined, "an ok check must not carry a fix line");
  assert.equal(byName.agent.status, "warn");
  assert.ok(byName.agent.fix, "a non-ok check must carry a fix line");
  assert.equal(byName.git.status, "warn");
  assert.equal(byName["run-state-integrity"].status, "ok", "no runs yet: ok, not a warning");

  // --json never carries ANSI, even when FORCE_COLOR asks for color.
  const jsonForced = run(["doctor", "--json"], { cwd, env: { ...ENV, FORCE_COLOR: "1" } });
  assert.equal(jsonForced.stdout, json.stdout, "machine payload is never styled");

  // --- a broken state.json is a warning that names the run ---
  const broken = freshDir("broken");
  fs.mkdirSync(path.join(broken, ".cw", "runs", "r1"), { recursive: true });
  fs.writeFileSync(path.join(broken, ".cw", "runs", "r1", "state.json"), "{bad");
  const warned = JSON.parse(run(["doctor", "--json"], { cwd: broken, env: ENV }).stdout);
  const integrity = warned.checks.find((c) => c.name === "run-state-integrity");
  assert.equal(integrity.status, "warn");
  assert.match(integrity.detail, /^1 of 1 run\(s\) have a state\.json problem: r1: /);
  assert.ok(integrity.fix);

  // --- doctor never writes anything under the checked cwd ---
  const beforeEntries = fs.readdirSync(cwd);
  run(["doctor", "--json"], { cwd, env: ENV });
  assert.deepEqual(fs.readdirSync(cwd), beforeEntries, "doctor is read-only over the cwd");
});

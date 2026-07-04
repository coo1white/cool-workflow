#!/usr/bin/env node
"use strict";

// The Rule of Silence: lib.run always spawns piped (spawnSync never gives
// the child a TTY), so stderr must be empty on a normal successful run —
// stdout carries only the data. CW_DRIVE_PROGRESS=1 is the one documented
// escape hatch that forces the drive progress lines on even off a TTY; it
// writes to stderr only, and stdout stays byte-clean JSON either way.

const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  // --- plain piped run: stderr is empty, stdout has no ANSI ---
  const repo1 = gitRepo({ "a.txt": "hello\n" });
  const plain = run(["run", "end-to-end-golden-path", "--drive", "--question", "q", "--repo", repo1], {
    env: stubAgentEnv("a.txt:1"),
  });
  assert.equal(plain.status, 0);
  assert.equal(plain.stderr, "", "piped stderr must be empty on a normal successful run");
  assert.ok(!/\x1b\[/.test(plain.stdout), "stdout must never carry ANSI codes");
  const plainPayload = JSON.parse(plain.stdout);
  assert.equal(plainPayload.status, "complete");

  // --- --json is the explicit ask for the same clean payload, same silence ---
  const repo2 = gitRepo({ "a.txt": "hello\n" });
  const asJson = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "q", "--repo", repo2, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  assert.equal(asJson.stderr, "");
  assert.equal(JSON.parse(asJson.stdout).status, "complete");

  // --- --full changes the intent (asks for the report inline on a TTY),
  // but off a TTY it changes NOTHING observable: still silent stderr, still
  // clean stdout. The inline full-report text only exists behind isTTY.
  const repo3 = gitRepo({ "a.txt": "hello\n" });
  const full = run(["run", "end-to-end-golden-path", "--drive", "--question", "q", "--repo", repo3, "--full"], {
    env: stubAgentEnv("a.txt:1"),
  });
  assert.equal(full.status, 0);
  assert.equal(full.stderr, "", "--full does not defeat the Rule of Silence off a TTY");
  assert.ok(!full.stdout.includes("──── full report ────"), "the inline full report is TTY-only chrome");

  // --- the one documented escape hatch: CW_DRIVE_PROGRESS=1 forces the
  // drive's own progress lines onto stderr even though this is not a TTY.
  // This is the intentional contrast case: chrome shows up, but only on
  // stderr, with the fixed "[drive] " prefix, and stdout is unaffected.
  const repo4 = gitRepo({ "a.txt": "hello\n" });
  const forced = run(["run", "end-to-end-golden-path", "--drive", "--question", "q", "--repo", repo4], {
    env: Object.assign({}, stubAgentEnv("a.txt:1"), { CW_DRIVE_PROGRESS: "1" }),
  });
  assert.equal(forced.status, 0);
  assert.notEqual(forced.stderr, "", "CW_DRIVE_PROGRESS=1 must force progress chrome on");
  for (const line of forced.stderr.split("\n").filter(Boolean)) {
    assert.match(line, /^\[drive\] /, "every drive progress line carries the fixed prefix");
  }
  assert.ok(!/\x1b\[/.test(forced.stdout), "stdout stays clean even when drive progress is forced on");
  assert.equal(JSON.parse(forced.stdout).status, "complete", "stdout is unaffected by the stderr chrome");

  // --- CW_DRIVE_PROGRESS=0 is the explicit off switch (redundant off a
  // TTY-less spawn, but must not error and must stay silent) ---
  const repo5 = gitRepo({ "a.txt": "hello\n" });
  const suppressed = run(["run", "end-to-end-golden-path", "--drive", "--question", "q", "--repo", repo5], {
    env: Object.assign({}, stubAgentEnv("a.txt:1"), { CW_DRIVE_PROGRESS: "0" }),
  });
  assert.equal(suppressed.stderr, "");
});

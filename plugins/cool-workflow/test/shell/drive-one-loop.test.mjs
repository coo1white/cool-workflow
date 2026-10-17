#!/usr/bin/env node
// drive-one-loop — issue #787 item 2. drive() and driveAsync() run one
// round loop (driveRounds in src/shell/drive.ts); the only thing the async
// one adds is a turn of the event loop between rounds. So, on the same
// planned run, the two must give the same DriveResult, the same stderr
// progress lines, and the same stop on a SIGINT, and must leave no
// SIGINT/SIGTERM listener behind.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..", "..");
import { drive, driveAsync } from "../../dist/shell/drive.js";
import { loadWorkflowApp } from "../../dist/shell/workflow-app-loader.js";
import { plan } from "../../dist/shell/pipeline.js";

function writeStub(file) {
  const fence = String.fromCharCode(96).repeat(3);
  const lines = [
    'const fs = require("fs");',
    "const rp = process.argv[2];",
    `const body = "# R\\n\\n" + ${JSON.stringify(fence)} + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + ${JSON.stringify(fence)} + "\\n";`,
    "fs.writeFileSync(rp, body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 1, output_tokens: 1 } }));',
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function listenerCounts() {
  return { SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM") };
}

// Plans a golden-path run in a new temp dir and drives it with `driver`
// (drive or driveAsync). `onProgress(lineIndex)` is called for each stderr
// line. Gives back the result with the run id and temp dir taken out, so two
// runs can be compared, and the stderr lines the same way.
async function driveOnce(driver, options = {}, onProgress = () => {}) {
  const cwd0 = process.cwd();
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-one-loop-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  const saved = { write: process.stderr.write, env: { ...process.env } };
  const lines = [];
  let runId;
  try {
    process.chdir(work);
    const p = plan(loadWorkflowApp("end-to-end-golden-path"), { repo: work, question: "one loop" });
    runId = p.id;
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [writeStub(path.join(work, "stub.js")), "{{result}}"], source: "flag" };
    process.env.CW_DRIVE_PROGRESS = "1";
    process.stderr.write = function (chunk) {
      lines.push(String(chunk));
      onProgress(lines.length - 1);
      return true;
    };
    const result = await driver(p.id, work, { now: "2026-07-01T00:00:00.000Z", agentConfig, ...options });
    process.stderr.write = saved.write;
    const scrub = (text) => text.split(work).join("<work>").split(runId).join("<run>");
    return { result: JSON.parse(scrub(JSON.stringify(result))), lines: lines.map(scrub), tasks: p.tasks.length };
  } finally {
    process.stderr.write = saved.write;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

(async () => {
  const before = listenerCounts();

  // 1. A full drive: same result, same steps, same progress lines.
  const syncFull = await driveOnce(drive);
  const asyncFull = await driveOnce(driveAsync);
  assert.equal(syncFull.result.status, "complete", "the sync drive finishes the run");
  assert.ok(syncFull.result.steps.length > 1, "the full drive took more than one round");
  assert.deepEqual(asyncFull.result, syncFull.result, "driveAsync gives the same DriveResult as drive");
  assert.ok(syncFull.lines.some((l) => l.includes("==>")), "the drive printed phase progress lines");
  assert.deepEqual(asyncFull.lines, syncFull.lines, "driveAsync prints the same stderr lines as drive");
  assert.deepEqual(listenerCounts(), before, "no stop-signal listener is left after a full drive");

  // 2. --once: one step only, the same from both.
  const syncOnce = await driveOnce(drive, { once: true });
  const asyncOnce = await driveOnce(driveAsync, { once: true });
  assert.equal(syncOnce.result.steps.length, 1, "--once takes one step");
  assert.deepEqual(asyncOnce.result, syncOnce.result, "--once: same DriveResult from both");
  assert.deepEqual(asyncOnce.lines, syncOnce.lines, "--once: same stderr lines from both");

  // 3. A SIGINT at the first progress line: both stop after that round with
  //    the same "interrupted" blocked step and the same lines, and take
  //    their listener off again.
  const interrupt = (index) => {
    if (index === 0) process.emit("SIGINT", "SIGINT");
  };
  const syncStop = await driveOnce(drive, {}, interrupt);
  const asyncStop = await driveOnce(driveAsync, {}, interrupt);
  assert.equal(syncStop.result.status, "blocked", "a SIGINT stops the sync drive as blocked");
  const lastStep = syncStop.result.steps[syncStop.result.steps.length - 1];
  assert.match(lastStep.reason, /drive interrupted by SIGINT — resume: cw --resume --run <run>/);
  assert.equal(syncStop.result.steps.length, 2, "the drive stopped after the first round: one worker step, then the blocked step");
  assert.equal(syncStop.result.commitId, undefined, "the interrupted drive made no commit");
  assert.ok(syncStop.lines.some((l) => l.includes("received SIGINT")), "the stop line was printed");
  assert.deepEqual(asyncStop.result, syncStop.result, "SIGINT: same DriveResult from both");
  assert.deepEqual(asyncStop.lines, syncStop.lines, "SIGINT: same stderr lines from both");
  assert.deepEqual(listenerCounts(), before, "no stop-signal listener is left after an interrupted drive");

  // 4. An error in a round still takes the listener off (the generator's
  //    finally runs when the error goes up through it).
  for (const driver of [drive, driveAsync]) {
    await assert.rejects(
      driveOnce(driver, {}, (index) => {
        if (index === 0) throw new Error("boom between rounds");
      }),
      /boom between rounds/
    );
    assert.deepEqual(listenerCounts(), before, `no stop-signal listener is left after ${driver.name} throws`);
  }

  console.log("drive-one-loop: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

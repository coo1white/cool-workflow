#!/usr/bin/env node
"use strict";

// `cw backend agent config set` persists a durable, secret-stripped
// agent-config.json under $CW_HOME: 2-space JSON + one trailing newline,
// the api-key value never lands on disk, and a later plain `cw backend
// agent config` (no flags) reads that same file back as source:"file".

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

caseMain(() => {
  const cwd = freshDir("cwd");

  const set = run(
    ["backend", "agent", "config", "set", "--agent-command", "echo hi --api-key sk-SECRETVALUE0000000000000", "--agent-model", "policy-model"],
    { cwd }
  );
  assert.equal(set.status, 0);
  const setPayload = JSON.parse(set.stdout);
  assert.equal(setPayload.configured, true);
  assert.equal(setPayload.fileExists, true);
  assert.ok(!setPayload.config.args.some((a) => a.includes("sk-SECRETVALUE0000000000000")));

  const configPath = setPayload.path;
  assert.ok(fs.existsSync(configPath), "agent-config.json must exist on disk");
  const raw = fs.readFileSync(configPath, "utf8");
  assert.ok(!raw.includes("sk-SECRETVALUE0000000000000"), "the raw secret must never be written to disk");
  assert.ok(raw.endsWith("\n"), "file must end with one trailing newline");
  assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 2) + "\n", "2-space JSON, no extra whitespace drift");

  const onDisk = JSON.parse(raw);
  assert.equal(onDisk.schemaVersion, 1);
  assert.equal(onDisk.command, "echo");
  assert.ok(onDisk.args.includes("<redacted>"));
  assert.equal(onDisk.model, "policy-model");
  assert.equal(onDisk.source, "file");

  // A later plain read (no flags, no matching env) picks the persisted
  // file up as source "file".
  const show = run(["backend", "agent", "config"], { cwd, env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(show.status, 0);
  const shown = JSON.parse(show.stdout);
  assert.equal(shown.configured, true);
  assert.equal(shown.source, "file");
  assert.equal(shown.fileExists, true);
  assert.equal(shown.config.command, "echo");
  assert.equal(shown.config.model, "policy-model");
});

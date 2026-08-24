#!/usr/bin/env node
// runregistryio-queue-io — pins RunRegistry's on-disk round-trips through a
// private CW_HOME (the env is passed in, never process.env): resolveCwHome
// order, queue add/list/show/drain, registerRepo, fail-CLOSED reads of a
// corrupt queue.json and a corrupt archive overlay (durable state), and the
// fail-OPEN read of a corrupt persisted index.json (a rebuildable cache) —
// the asymmetric rule from SPEC/scheduling-registry.md.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RunRegistry, resolveCwHome } = require("../dist/shell/run-registry-io");
const { readJson } = require("../dist/shell/fs-atomic");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-registry-io-"));

function freshRegistry(name) {
  const repo = path.join(tmp, name, "repo");
  const home = path.join(tmp, name, "home");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { repo, home, reg: new RunRegistry(repo, undefined, { CW_HOME: home }) };
}

// --- resolveCwHome: CW_HOME first, then XDG_STATE_HOME/cool-workflow,
// then ~/.local/state/cool-workflow. Blank values are passed over.
{
  assert.equal(resolveCwHome({ CW_HOME: "/a/b" }), path.resolve("/a/b"));
  assert.equal(resolveCwHome({ CW_HOME: "/a/b", XDG_STATE_HOME: "/x" }), path.resolve("/a/b"), "CW_HOME wins");
  assert.equal(resolveCwHome({ XDG_STATE_HOME: "/x" }), path.join(path.resolve("/x"), "cool-workflow"));
  assert.equal(resolveCwHome({ CW_HOME: "   ", XDG_STATE_HOME: "/x" }), path.join(path.resolve("/x"), "cool-workflow"), "a blank CW_HOME is passed over");
  assert.equal(resolveCwHome({}), path.join(os.homedir(), ".local", "state", "cool-workflow"));
}

// --- queueAdd/queueList/queueShow/queueDrain round-trip through queue.json.
{
  const { repo, home, reg } = freshRegistry("queue");
  const early = reg.queueAdd({ appId: "demo", note: "first" });
  assert.match(early.id, /^q-\d{14}-\d{3}$/);
  assert.equal(early.status, "pending");
  assert.equal(early.priority, 100, "the default priority");
  assert.equal(early.repo, repo);

  const urgent = reg.queueAdd({ appId: "urgent-app", priority: 5, id: "q-fixed-001" });
  assert.equal(urgent.id, "q-fixed-001", "a given id is used as-is");

  // The file on disk has the durable shape and both entries.
  const file = reg.queueFilePath();
  assert.equal(file, path.join(home, "registry", "queue.json"));
  const onDisk = readJson(file);
  assert.equal(onDisk.schemaVersion, 1);
  assert.equal(onDisk.entries.length, 2);

  // queueList sorts by priority first.
  const list = reg.queueList();
  assert.equal(list.total, 2);
  assert.deepEqual(list.entries.map((e) => e.id), ["q-fixed-001", early.id], "priority 5 before priority 100");
  assert.equal(reg.queueList({ status: "drained" }).total, 0);

  // queueShow finds one entry; an unknown id is a hard stop.
  assert.equal(reg.queueShow(early.id).note, "first");
  assert.throws(() => reg.queueShow("q-nope"), /Queue entry not found: q-nope/);

  // queueDrain takes the best entry, marks it drained, and persists that.
  const drainResult = reg.queueDrain({ limit: 1 });
  assert.equal(drainResult.drained.length, 1);
  assert.equal(drainResult.drained[0].id, "q-fixed-001", "the lowest priority number drains first");
  assert.equal(drainResult.drained[0].status, "drained");
  assert.ok(drainResult.drained[0].drainedAt, "drainedAt is stamped");
  assert.equal(drainResult.remaining, 1);
  const afterDrain = readJson(file).entries.find((e) => e.id === "q-fixed-001");
  assert.equal(afterDrain.status, "drained", "the drain is saved to disk");

  // queueAdd also registered the repo in repos.json.
  const repos = readJson(path.join(home, "registry", "repos.json"));
  assert.deepEqual(repos.repos.map((r) => r.root), [repo]);
}

// --- registerRepo: true once, false after, list kept sorted.
{
  const { repo, reg } = freshRegistry("repos");
  const otherA = path.join(tmp, "repos", "a-repo");
  const otherZ = path.join(tmp, "repos", "z-repo");
  assert.equal(reg.registerRepo(otherZ).registered, true);
  assert.equal(reg.registerRepo(otherA).registered, true);
  assert.equal(reg.registerRepo(otherZ).registered, false, "a second add of the same repo is a no-op");
  assert.deepEqual(reg.registerRepo(repo).repos, [otherA, repo, otherZ].sort(), "kept in sorted order");
}

// --- Corrupt queue.json: FAIL CLOSED. The queue is durable state, not a
// rebuildable cache — a broken file must stop reads AND writes, and the
// broken bytes must be left in place for a person to look at.
{
  const { reg } = freshRegistry("queue-corrupt");
  reg.queueAdd({ appId: "demo" });
  const file = reg.queueFilePath();
  fs.writeFileSync(file, '{"schemaVersion":1,"entries":[{"id"', "utf8");
  const brokenBytes = fs.readFileSync(file, "utf8");

  assert.throws(() => reg.loadQueueEntries(), /Invalid JSON in /, "reads refuse a corrupt queue");
  assert.throws(() => reg.queueAdd({ appId: "later" }), /Invalid JSON in /, "writes refuse too");
  assert.throws(() => reg.queueDrain(), /Invalid JSON in /);
  assert.equal(fs.readFileSync(file, "utf8"), brokenBytes, "the broken bytes are NOT overwritten");
}

// --- Corrupt archive overlay: FAIL CLOSED with the exact "Corrupt overlay"
// error, for both a JSON array and null.
{
  const { repo, reg } = freshRegistry("overlay-corrupt");
  fs.mkdirSync(path.join(repo, ".cw", "runs"), { recursive: true });
  const overlayFile = path.join(repo, ".cw", "registry", "archive.json");
  fs.mkdirSync(path.dirname(overlayFile), { recursive: true });

  fs.writeFileSync(overlayFile, "[]", "utf8");
  assert.throws(() => reg.search({}), /Corrupt overlay .*archive\.json: expected a JSON object, got array/);

  fs.writeFileSync(overlayFile, "null", "utf8");
  assert.throws(() => reg.search({}), /Corrupt overlay .*archive\.json: expected a JSON object, got null/);
}

// --- Persisted index.json: FAIL OPEN. It is a rebuildable cache — corrupt
// bytes read as "absent", never as an error; a wrong fingerprint reads as
// "stale"; a run only present in the persisted index is named as missing.
{
  const { repo, reg } = freshRegistry("index");
  const report = reg.refresh();
  assert.equal(report.freshness.status, "valid", "right after refresh the index is valid");
  assert.equal(report.counts.total, 0);

  const indexFile = path.join(repo, ".cw", "registry", "index.json");
  assert.ok(fs.existsSync(indexFile), "refresh persisted the repo index");

  // Corrupt cache: reads as absent (fail open), and the next action is a refresh.
  fs.writeFileSync(indexFile, "{ half a file", "utf8");
  const absent = reg.show();
  assert.equal(absent.freshness.status, "absent");
  assert.equal(absent.nextAction, "cw registry refresh");

  // A wrong persisted fingerprint reads as stale.
  reg.refresh();
  const persisted = readJson(indexFile);
  persisted.sourceFingerprint = "sha256:not-the-real-one";
  fs.writeFileSync(indexFile, JSON.stringify(persisted), "utf8");
  assert.equal(reg.show().freshness.status, "stale");

  // A record only present in the persisted index is reported missing.
  reg.refresh();
  const persisted2 = readJson(indexFile);
  persisted2.records.push({ runId: "ghost-run", sourceFingerprint: "sha256:x" });
  fs.writeFileSync(indexFile, JSON.stringify(persisted2), "utf8");
  const stale = reg.show();
  assert.equal(stale.freshness.status, "stale");
  assert.deepEqual(stale.freshness.missingRuns, ["ghost-run"]);
}

process.stdout.write("runregistryio-queue-io: ok\n");

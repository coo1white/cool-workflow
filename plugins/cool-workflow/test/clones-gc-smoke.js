#!/usr/bin/env node
"use strict";

// clones-gc-smoke — manage the remote-source clone cache (`cw clones list` / `cw clones gc`).
// Hermetic: seeds a throwaway CW_HOME/clones with a stale entry and a fresh entry (no network,
// no agent), then asserts list reports them, a TTL gc reclaims only the stale one, --all
// reclaims the rest, and gc NEVER touches anything outside the clones cache (containment).

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cleanups = [];

function freshHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-clones-home-")));
  cleanups.push(home);
  return home;
}
function run(args, home) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: home,
    encoding: "utf8",
    env: { ...process.env, CW_HOME: home, HOME: home, XDG_STATE_HOME: path.join(home, "state") }
  });
}
// Seed a fake cached checkout: a hash dir with a sized payload + a git marker, and (unless
// meta is null) a meta file. A null meta models a partial/legacy materialize that never wrote one.
function seedClone(home, hash, meta, payloadBytes) {
  const dir = path.join(home, "clones", hash);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (meta) fs.writeFileSync(path.join(dir, ".cw-clone-meta.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, "README.md"), "x".repeat(payloadBytes));
  return dir;
}
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// ===== 1. `clones list` reports every cached checkout =====
{
  const home = freshHome();
  seedClone(home, "a".repeat(24), { url: "file:///stale.git", kind: "git", commit: "1".repeat(40), fetchedAt: daysAgo(40) }, 100);
  seedClone(home, "b".repeat(24), { url: "https://example.com/fresh.tar.gz", kind: "archive", commit: "deadbeef", fetchedAt: daysAgo(0) }, 200);
  const r = run(["clones", "list", "--json"], home);
  assert.equal(r.status, 0, `clones list: ${r.stderr}`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.count, 2, "lists both cached checkouts");
  assert.ok(p.totalBytes > 0, "reports total bytes");
  assert.ok(p.entries.some((e) => e.kind === "archive" && e.url.includes("fresh")), "carries kind + origin url");
  // human output is readable + non-empty.
  const human = run(["clones", "list"], home);
  assert.match(human.stdout, /cached checkout/, "human list has a header");
  console.log("clones: list reports cached checkouts ok");
}

// ===== 2. `clones gc --older-than-days N` reclaims only entries older than the window =====
{
  const home = freshHome();
  seedClone(home, "a".repeat(24), { url: "file:///stale.git", kind: "git", fetchedAt: daysAgo(40) }, 100);
  seedClone(home, "b".repeat(24), { url: "file:///fresh.git", kind: "git", fetchedAt: daysAgo(0) }, 200);
  const r = run(["clones", "gc", "--older-than-days", "30", "--json"], home);
  assert.equal(r.status, 0, `clones gc: ${r.stderr}`);
  const p = JSON.parse(r.stdout);
  assert.equal(p.removed.length, 1, "reclaims exactly the stale entry");
  assert.match(p.removed[0].url, /stale/, "reclaimed the 40-day-old checkout");
  assert.equal(p.keptCount, 1, "keeps the fresh one");
  assert.ok(p.freedBytes > 0, "reports freed bytes");
  assert.ok(!fs.existsSync(path.join(home, "clones", "a".repeat(24))), "stale dir is gone");
  assert.ok(fs.existsSync(path.join(home, "clones", "b".repeat(24))), "fresh dir remains");
  console.log("clones: gc TTL reclaims only stale entries ok");
}

// ===== 3. `clones gc --all` reclaims everything — but NOTHING outside the clones cache =====
{
  const home = freshHome();
  seedClone(home, "a".repeat(24), { url: "file:///one.git", kind: "git", fetchedAt: daysAgo(1) }, 100);
  seedClone(home, "c".repeat(24), { url: "file:///two.git", kind: "git", fetchedAt: daysAgo(2) }, 100);
  // a sentinel OUTSIDE clones/ that gc must never touch (containment).
  const sentinel = path.join(home, "DO-NOT-DELETE.txt");
  fs.writeFileSync(sentinel, "keep me");
  const r = run(["clones", "gc", "--all", "--json"], home);
  const p = JSON.parse(r.stdout);
  assert.equal(p.removed.length, 2, "--all reclaims every cached checkout");
  assert.equal(p.keptCount, 0, "nothing kept");
  assert.ok(fs.existsSync(sentinel), "gc never touches a path outside the clones cache (containment)");
  const after = JSON.parse(run(["clones", "list", "--json"], home).stdout);
  assert.equal(after.count, 0, "the cache is empty after --all");
  console.log("clones: gc --all reclaims all + respects containment ok");
}

// ===== 4. empty cache: list says so, gc is a no-op (idempotent, exit 0) =====
{
  const home = freshHome();
  const list = run(["clones", "list"], home);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /No cached remote checkouts/, "empty cache reads clearly");
  const gc = run(["clones", "gc", "--json"], home);
  assert.equal(gc.status, 0, "gc on an empty cache is a clean no-op");
  assert.equal(JSON.parse(gc.stdout).removed.length, 0);
  console.log("clones: empty-cache list + gc no-op ok");
}

// ===== 5. a partial entry with NO meta is fail-SAFE: a TTL sweep keeps it; --all clears it =====
// (We can't date an entry that never wrote .cw-clone-meta.json, so a TTL sweep must NOT delete
//  it — deleting what you can't age would surprise-reclaim a fresh-but-partial materialize.)
{
  const home = freshHome();
  seedClone(home, "a".repeat(24), null, 100); // no meta → undateable
  const ttl = run(["clones", "gc", "--older-than-days", "30", "--json"], home);
  assert.equal(JSON.parse(ttl.stdout).removed.length, 0, "a TTL sweep KEEPS an undateable (no-meta) entry");
  assert.ok(fs.existsSync(path.join(home, "clones", "a".repeat(24))), "the no-meta entry survives the TTL sweep");
  const all = run(["clones", "gc", "--all", "--json"], home);
  assert.equal(JSON.parse(all.stdout).removed.length, 1, "--all reclaims the no-meta entry");
  console.log("clones: no-meta entry is TTL-safe but --all-reclaimable ok");
}

// ===== 6. input validation fails closed with a clear error (never a surprise delete) =====
{
  const home = freshHome();
  seedClone(home, "b".repeat(24), { url: "file:///x.git", kind: "git", fetchedAt: daysAgo(99) }, 100);
  // The equals form is the only way a `-`-leading value reaches the flag (the space form is
  // already neutralized by the parser, which never lets a flag swallow another flag).
  const neg = run(["clones", "gc", "--older-than-days=-5", "--json"], home);
  assert.equal(neg.status, 1, "a negative --older-than-days is rejected (not a future cutoff that deletes all)");
  assert.match(neg.stderr, /non-negative/, "explains the constraint");
  const badNow = run(["clones", "gc", "--now", "not-a-date", "--json"], home);
  assert.equal(badNow.status, 1, "an unparseable --now is rejected, not silently NaN'd");
  assert.match(badNow.stderr, /valid ISO date/, "explains the constraint");
  assert.ok(fs.existsSync(path.join(home, "clones", "b".repeat(24))), "nothing was deleted on a validation error");
  console.log("clones: gc input validation fails closed ok");
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
console.log("clones-gc-smoke: ok");

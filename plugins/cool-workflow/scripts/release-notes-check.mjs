#!/usr/bin/env node
// release-notes-check.mjs — a GitHub Release's notes cover exactly the
// changes since the previous release, and nothing older.
//
// The fault it holds (2026-11-13): a release tag sits on a bump commit
// beside main, so GitHub's generated notes started at the last ANCESTOR tag
// (v0.2.2), and v0.4.5 to v0.5.0 each listed ~510 PRs instead of their own
// handful. release.yml now passes --notes-start-tag; this check runs after
// every `gh release create` and fails the job if the range is still wrong.
//
//   node scripts/release-notes-check.mjs --tag vX.Y.Z [--fix]
//   node scripts/release-notes-check.mjs --all [--fix]
//
// A release is right when its "Full Changelog" compare link starts at the
// release just below it by version order (release-tags.mjs releaseBefore).
// Notes with no compare link were written by hand and are left alone; the
// first release has nothing before it. --fix regenerates wrong notes from
// that range (`gh api .../releases/generate-notes`), writes them with
// `gh release edit --notes-file`, and reads them back. Exit 1 when any
// release is still wrong.
//
// Needs `gh` (authenticated; GH_REPO names the repository, else `gh repo
// view` does) and the release tags fetched (`git fetch --tags`).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { releaseBefore } from "./release-tags.mjs";

const argv = process.argv.slice(2);
const FIX = argv.includes("--fix");
const ALL = argv.includes("--all");
const tagArg = argv.includes("--tag") ? argv[argv.indexOf("--tag") + 1] : "";

function fail(msg) {
  process.stderr.write(`release-notes-check: ${msg}\n`);
  process.exit(1);
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function gh(args) {
  const r = run("gh", args);
  if (r.code !== 0) fail(`gh ${args.slice(0, 2).join(" ")} failed: ${r.err || r.out}`);
  return r.out;
}
const gitOut = (args) => {
  const r = run("git", args);
  return r.code === 0 ? r.out : "";
};

/** The compare base the notes start at, or null for hand-written notes. */
function notesBase(body, tag) {
  const esc = tag.replace(/[.]/g, "\\.");
  const m = new RegExp(`/compare/(\\S+?)\\.\\.\\.${esc}(?![0-9A-Za-z.])`).exec(body || "");
  return m ? m[1] : null;
}

function bodyOf(tag) {
  return gh(["release", "view", tag, "--json", "body", "--jq", ".body"]);
}

function check(tag, repo) {
  const prev = releaseBefore(gitOut, tag);
  if (prev === null) return { tag, ok: true, why: "not a vX.Y.Z tag" };
  if (!prev) return { tag, ok: true, why: "the first release" };
  const base = notesBase(bodyOf(tag), tag);
  if (base === null) return { tag, ok: true, why: "hand-written notes (no compare link)" };
  if (base === prev) return { tag, ok: true, why: `starts at ${prev}` };
  if (!FIX) return { tag, ok: false, why: `starts at ${base}, not ${prev}` };
  const notes = gh(["api", `repos/${repo}/releases/generate-notes`, "-f", `tag_name=${tag}`, "-f", `previous_tag_name=${prev}`, "--jq", ".body"]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cw-notes-")), "notes.md");
  fs.writeFileSync(file, `${notes}\n`);
  gh(["release", "edit", tag, "--notes-file", file]);
  const after = notesBase(bodyOf(tag), tag);
  return after === prev
    ? { tag, ok: true, why: `fixed: started at ${base}, now ${prev}` }
    : { tag, ok: false, why: `still starts at ${after} after the fix, not ${prev}` };
}

if (!ALL && !/^v\d+\.\d+\.\d+$/.test(tagArg || "")) fail("usage: release-notes-check.mjs (--tag vX.Y.Z | --all) [--fix]");
const repo = process.env.GH_REPO || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const tags = ALL ? [...new Set(gh(["release", "list", "--limit", "1000", "--json", "tagName", "--jq", ".[].tagName"]).split("\n").filter(Boolean))] : [tagArg];
let wrong = 0;
for (const tag of tags) {
  const r = check(tag, repo);
  if (!r.ok) wrong++;
  process.stdout.write(`release-notes-check: ${r.ok ? "ok  " : "WRONG"} ${tag}: ${r.why}\n`);
}
if (wrong) fail(`${wrong} release(s) list changes from before the previous release${FIX ? "" : "; run again with --fix"}`);

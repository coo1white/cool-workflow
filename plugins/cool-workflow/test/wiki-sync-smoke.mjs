#!/usr/bin/env node
// wiki-sync-smoke — holds scripts/wiki-sync.mjs and the wiki copy in
// project/docs/wiki/. Included in `npm test`.
//
// 1. the real copy: every redirect in redirects.json points at a mirror
//    page, no redirect has a mirror page's name, every page linked from
//    _Sidebar.md is in the mirror, and every link between mirror pages
//    goes to a mirror page or a redirect.
// 2. the script, run for real into a temp folder: it writes every mirror
//    page and every redirect page, names each file it changed on stdout,
//    names nothing on a second run, leaves other pages alone, and never
//    makes a .git folder.
// 3. teeth: a redirect to a page that is not in the mirror, and one with a
//    mirror page's name, are refused and nothing is written.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";
import {
  MIRROR_DIR,
  REDIRECTS_FILE,
  checkRedirects,
  mirrorPages,
  planWikiSync,
  redirectPage
} from "../scripts/wiki-sync.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(pluginRoot, "scripts", "wiki-sync.mjs");

const pages = mirrorPages(MIRROR_DIR);
const pageNames = new Set(pages.map((file) => file.slice(0, -3)));
const redirects = JSON.parse(fs.readFileSync(REDIRECTS_FILE, "utf8"));

// 1. The real copy.
assert.ok(pages.includes("Home.md") && pages.includes("_Sidebar.md"), "the mirror has Home.md and _Sidebar.md");
assert.deepEqual(checkRedirects(redirects, pages), [], "redirects.json is good");
for (const [name, entry] of Object.entries(redirects)) {
  assert.ok(pageNames.has(entry.to), `redirect ${name} -> ${entry.to}: target is in the mirror`);
  assert.ok(!pageNames.has(name), `redirect ${name}: not also a mirror page`);
}

function localLinks(text) {
  return [...text.matchAll(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g)]
    .map((match) => match[1])
    .filter((link) => !/^[a-z]+:/i.test(link));
}

const sidebar = fs.readFileSync(path.join(MIRROR_DIR, "_Sidebar.md"), "utf8");
const sidebarLinks = localLinks(sidebar);
assert.ok(sidebarLinks.length > 0, "_Sidebar.md links to pages");
for (const link of sidebarLinks) {
  assert.ok(pages.includes(link), `_Sidebar.md links to ${link}, which is a mirror page`);
}

const known = new Set([...pageNames, ...Object.keys(redirects)]);
for (const file of pages) {
  const text = fs.readFileSync(path.join(MIRROR_DIR, file), "utf8");
  for (const link of localLinks(text)) {
    const name = link.endsWith(".md") ? link.slice(0, -3) : link;
    assert.ok(known.has(name), `${file} links to ${link}, which is neither a mirror page nor a redirect`);
  }
}

// 2. The script, for real, into a temp wiki checkout.
const tmp = tmpDir("cw-wiki-sync-");
try {
  const wiki = path.join(tmp, "wiki");
  fs.mkdirSync(wiki);
  fs.writeFileSync(path.join(wiki, "_Footer.md"), "footer\n");
  fs.writeFileSync(path.join(wiki, "Home.md"), "old home\n");

  const first = spawnSync(process.execPath, [script, "--to", wiki], { encoding: "utf8" });
  assert.equal(first.status, 0, `first run exits 0: ${first.stderr}`);
  assert.equal(first.stderr, "", "first run writes nothing to stderr");
  const lines = first.stdout.trim().split("\n");
  assert.equal(lines.length, pages.length + Object.keys(redirects).length, "one line per file written");
  assert.ok(lines.includes("updated Home.md"), "an existing page that differs is reported as updated");
  assert.ok(lines.includes("added _Sidebar.md"), "a new page is reported as added");

  for (const file of pages) {
    assert.equal(
      fs.readFileSync(path.join(wiki, file), "utf8"),
      fs.readFileSync(path.join(MIRROR_DIR, file), "utf8"),
      `${file} is copied byte for byte`
    );
  }
  for (const [name, entry] of Object.entries(redirects)) {
    const text = fs.readFileSync(path.join(wiki, `${name}.md`), "utf8");
    assert.equal(text, redirectPage(name, entry), `${name}.md is its redirect page`);
    assert.ok(text.includes(`](${entry.to}.md)`), `${name}.md links to ${entry.to}`);
    assert.ok(text.includes(entry.why), `${name}.md says why`);
  }
  assert.equal(fs.readFileSync(path.join(wiki, "_Footer.md"), "utf8"), "footer\n", "a page in neither list is left alone");
  assert.ok(!fs.existsSync(path.join(wiki, ".git")), "the script runs no git");

  const second = spawnSync(process.execPath, [script, "--to", wiki], { encoding: "utf8" });
  assert.equal(second.status, 0, "second run exits 0");
  assert.equal(second.stdout, "", "a second run changes nothing and says nothing");

  const usage = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(usage.status, 2, "no --to is a usage error");
  assert.equal(usage.stdout, "", "a usage error writes nothing to stdout");

  const missing = spawnSync(process.execPath, [script, "--to", path.join(tmp, "nope")], { encoding: "utf8" });
  assert.equal(missing.status, 1, "a --to folder that is not there is refused");

  // 3. Teeth.
  assert.throws(
    () => planWikiSync({ redirects: { "Old-Page": { to: "Not-A-Page", why: "Gone." } } }),
    /Old-Page: "to" \(Not-A-Page\) is not a mirror page/,
    "a redirect to a page not in the mirror is refused"
  );
  assert.throws(
    () => planWikiSync({ redirects: { Home: { to: "FAQ", why: "Gone." } } }),
    /Home: is a mirror page/,
    "a redirect with a mirror page's name is refused"
  );
  assert.throws(
    () => planWikiSync({ redirects: { "Old-Page": { to: "Home", why: "" } } }),
    /"why" must be one line/,
    "a redirect with no reason is refused"
  );
  assert.throws(() => planWikiSync({ redirects: [] }), /one JSON object/, "a list is not a redirect map");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// The script holds no git call (the operator commits and pushes).
const source = fs.readFileSync(script, "utf8");
assert.ok(!/child_process/.test(source), "wiki-sync.mjs starts no child process");

// The script is named by its consumer.
const agents = fs.readFileSync(path.join(pluginRoot, "..", "..", "AGENTS.md"), "utf8");
assert.ok(agents.includes("scripts/wiki-sync.mjs"), "AGENTS.md names wiki-sync.mjs (its consumer)");

// Every mirror page on disk is tracked by git, so nothing is published from
// an untracked draft.
const tracked = execFileSync("git", ["-C", MIRROR_DIR, "ls-files", "--", "."], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
for (const file of [...pages, "redirects.json"]) {
  assert.ok(tracked.includes(file), `${file} is tracked by git`);
}

console.log("wiki-sync-smoke: ok");

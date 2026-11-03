#!/usr/bin/env node
// wiki-sync — put the wiki copy in project/docs/wiki/ into a checkout of the
// GitHub wiki.
//
// Consumer: AGENTS.md, "Shipping a release", step 3 (the wiki publish after
// a release); test/wiki-sync-smoke.mjs holds it.
//
//   node scripts/wiki-sync.mjs --to <wiki checkout dir>
//
// It does two things, and nothing more:
// 1. copies every project/docs/wiki/*.md page into the checkout;
// 2. writes one short pointer page for each entry of
//    project/docs/wiki/redirects.json ({ "<Page-Name>": { "to": "<Page>",
//    "why": "<one sentence>" } }), so an old wiki URL keeps working and
//    says where its text went.
// stdout gets one line per file it changed ("added <file>" or "updated
// <file>"); a page that is already the same is not named. It never runs git:
// the operator looks at `git status`, commits, and pushes. Pages in the
// checkout that are in neither list (_Footer.md, say) are left as they are.
// It fails closed, writing nothing, when redirects.json is not valid, when a
// redirect points at a page that is not in the mirror, or when a redirect
// has the name of a mirror page.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pluginRoot = path.resolve(import.meta.dirname, "..");
export const MIRROR_DIR = path.join(pluginRoot, "project", "docs", "wiki");
export const REDIRECTS_FILE = path.join(MIRROR_DIR, "redirects.json");

const PAGE_NAME = /^[^/\\\0]+$/;

export function mirrorPages(mirrorDir) {
  return fs
    .readdirSync(mirrorDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

export function pageTitle(pageName) {
  return pageName.replace(/-/g, " ");
}

export function redirectPage(name, entry) {
  return (
    `# ${pageTitle(name)}\n\n` +
    `${entry.why} See [${pageTitle(entry.to)}](${entry.to}.md).\n\n` +
    `The old text of this page is kept in its history.\n`
  );
}

// Every problem with the redirect list, as plain lines; empty means good.
export function checkRedirects(redirects, pages) {
  const problems = [];
  if (!redirects || typeof redirects !== "object" || Array.isArray(redirects)) {
    return ["redirects.json: must be one JSON object"];
  }
  const pageNames = new Set(pages.map((file) => file.slice(0, -3)));
  for (const [name, entry] of Object.entries(redirects)) {
    if (!PAGE_NAME.test(name) || name.endsWith(".md")) problems.push(`${name}: not a page name`);
    if (pageNames.has(name)) problems.push(`${name}: is a mirror page, so it may not be a redirect too`);
    if (!entry || typeof entry !== "object") {
      problems.push(`${name}: needs { "to", "why" }`);
      continue;
    }
    if (typeof entry.to !== "string" || !pageNames.has(entry.to)) {
      problems.push(`${name}: "to" (${entry.to}) is not a mirror page`);
    }
    if (typeof entry.why !== "string" || entry.why.trim() === "" || entry.why.includes("\n")) {
      problems.push(`${name}: "why" must be one line of text`);
    }
  }
  return problems;
}

// The files to write: [{ file, text }], mirror pages first, then redirects.
export function planWikiSync({ mirrorDir = MIRROR_DIR, redirects }) {
  const pages = mirrorPages(mirrorDir);
  const problems = checkRedirects(redirects, pages);
  if (problems.length > 0) {
    const error = new Error(`wiki-sync: refused:\n  ${problems.join("\n  ")}`);
    error.problems = problems;
    throw error;
  }
  const plan = pages.map((file) => ({ file, text: fs.readFileSync(path.join(mirrorDir, file), "utf8") }));
  for (const name of Object.keys(redirects).sort()) {
    plan.push({ file: `${name}.md`, text: redirectPage(name, redirects[name]) });
  }
  return plan;
}

// Writes the plan into targetDir; gives back the change lines.
export function applyWikiSync(plan, targetDir) {
  const changes = [];
  for (const { file, text } of plan) {
    const target = path.join(targetDir, file);
    const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (before === text) continue;
    fs.writeFileSync(target, text);
    changes.push(`${before === null ? "added" : "updated"} ${file}`);
  }
  return changes;
}

function main(argv) {
  const at = argv.indexOf("--to");
  const targetDir = at >= 0 ? argv[at + 1] : undefined;
  if (!targetDir || argv.length !== 2) {
    process.stderr.write("usage: node scripts/wiki-sync.mjs --to <wiki checkout dir>\n");
    return 2;
  }
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    process.stderr.write(`wiki-sync: not a folder: ${targetDir}\n`);
    return 1;
  }
  let plan;
  try {
    plan = planWikiSync({ redirects: JSON.parse(fs.readFileSync(REDIRECTS_FILE, "utf8")) });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  for (const line of applyWikiSync(plan, targetDir)) process.stdout.write(`${line}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}

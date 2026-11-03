#!/usr/bin/env node
// pola-check.mjs — POLA item 1 (AGENTS.md), held in PR CI and not first
// at release time. A changed byte-pinned output is a fault unless all of:
//   1. the version in package.json is raised over the last release, and
//   2. an intent file under project/docs/intent/ has a heading with
//      "Operator decisions for <version>", and that section names the pin
//      (its path, or a path end such as `cli-help/_root.txt`) and names a
//      man page (`<topic>.7.md`) that says the new text.
// The reviewer still reads the words; this check only holds the record to
// the pins, so a missing record fails a PR, not a release cut.
//
// Consumers: npm script `pola:check`, scripts/release-check.mjs (so CI's
// `release:check -- --skip-tests` runs it), test/pola-check-smoke.mjs.
//
// Base: the newest vX.Y.Z tag by semver (scripts/release-tags.mjs). A tag
// is a one-hop verdict leaf on the reviewed main commit, so the base is
// `<tag>^1` (`git describe` does not see these tags). No tag, or a shallow
// clone without the base commit, fails closed. CI checks out with
// fetch-depth: 0, which brings every tag.
//
// Pinned outputs (only MODIFIED or DELETED files count; an ADDED file is new
// surface, not a change to old bytes; a rename counts as a delete):
//   - v2/conformance/  — the black-box conformance suite: case files assert
//     exact CLI output, fixtures/ hold byte-exact captures (cli-help/*.txt).
//     ci.yml runs it on every PR as the "byte-identical behavior" promise.
//   - plugins/cool-workflow/test/fixtures/runs/ — old run state files that
//     test/run-fixture-compat-smoke.mjs requires to still load; changing one
//     moves the state-file compatibility line (a file layout under POLA).
// Not covered: exact text asserted inside plugins/cool-workflow/test/*.mjs
// smokes. Those mix pins with new checks line by line; the reviewer reads them.
//
// Output: silent, exit 0 when clean (Rule of Silence). Faults on stderr,
// exit 1. `--json` prints one JSON object on stdout (exit code the same).
// Test override: CW_POLA_ROOT is the git root to check in place of this repo.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listReleaseTagsDesc, parseSemverTag, compareSemver } from "./release-tags.mjs";

const PIN_ROOTS = ["v2/conformance/", "plugins/cool-workflow/test/fixtures/runs/"];
const PACKAGE_JSON = "plugins/cool-workflow/package.json";
const INTENT_DIR = "plugins/cool-workflow/project/docs/intent";
const NAME_CHAR = /[A-Za-z0-9_\-]/;

const pluginRoot = path.resolve(import.meta.dirname, "..");
const root = process.env.CW_POLA_ROOT || path.resolve(pluginRoot, "..", "..");
const json = process.argv.includes("--json");

class Refusal extends Error {}

function git(args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function resolveBase() {
  const tags = listReleaseTagsDesc((args) => git(args) || "");
  if (tags.length === 0) {
    throw new Refusal(
      "no vX.Y.Z release tag found, so there is no base to check against. " +
        "Fetch the tags (git fetch --tags) or use a full clone (CI: fetch-depth: 0)."
    );
  }
  const { tag, semver } = tags[0];
  const commit = git(["rev-parse", "--verify", "--quiet", `${tag}^1^{commit}`]);
  if (!commit) {
    const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
    throw new Refusal(
      `the reviewed commit of ${tag} (${tag}^1) is not in this clone` +
        (shallow ? " (it is a shallow clone)" : "") +
        ". Fetch the full history: git fetch --unshallow --tags (CI: fetch-depth: 0)."
    );
  }
  return { tag, commit, version: semver.join(".") };
}

function readVersion() {
  const file = path.join(root, PACKAGE_JSON);
  let version;
  try {
    version = JSON.parse(fs.readFileSync(file, "utf8")).version;
  } catch (error) {
    throw new Refusal(`cannot read the version from ${PACKAGE_JSON}: ${error.message}`);
  }
  if (typeof version !== "string" || !parseSemverTag(`v${version}`)) {
    throw new Refusal(`${PACKAGE_JSON} has no X.Y.Z version (found ${JSON.stringify(version)})`);
  }
  return version;
}

// Changed pins: base commit against the working tree, so a local run sees
// edits not yet committed. --no-renames makes a rename a D plus an A.
function changedPins(base) {
  const out = git(["diff", "--name-status", "--no-renames", base, "--", ...PIN_ROOTS]);
  if (out === null) throw new Refusal(`git diff against ${base} failed`);
  const pins = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (status === "M") pins.push({ path: file, status: "modified" });
    else if (status === "D") pins.push({ path: file, status: "deleted" });
    else if (status !== "A") pins.push({ path: file, status: `changed (${status})` });
  }
  return pins.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Every pin-root file at base or now, to find the shortest path end that
// names one file and no other (`state.json` alone names six fixtures).
function knownPinFiles(base) {
  const now = git(["ls-files", "--", ...PIN_ROOTS]) || "";
  const then = git(["ls-tree", "-r", "--name-only", base, "--", ...PIN_ROOTS]) || "";
  return [...new Set([...now.split("\n"), ...then.split("\n")].filter(Boolean))];
}

function shortestUniqueEnd(file, known) {
  const parts = file.split("/");
  for (let n = 1; n <= parts.length; n += 1) {
    const end = parts.slice(-n).join("/");
    const clash = known.some((other) => other !== file && (other === end || other.endsWith(`/${end}`)));
    if (!clash) return end;
  }
  return file;
}

// True when `end` (or any longer end of `file`) is in `text` as a whole name.
function names(text, file, end) {
  const parts = file.split("/");
  const minParts = end.split("/").length;
  for (let n = parts.length; n >= minParts; n -= 1) {
    const needle = parts.slice(-n).join("/");
    let at = text.indexOf(needle);
    while (at !== -1) {
      const before = at === 0 ? "" : text[at - 1];
      const after = text.slice(at + needle.length, at + needle.length + 2);
      const okBefore = !before || !(NAME_CHAR.test(before) || before === ".");
      const okAfter = !after || !(NAME_CHAR.test(after[0]) || after[0] === "/" || (after[0] === "." && NAME_CHAR.test(after[1] || "")));
      if (okBefore && okAfter) return true;
      at = text.indexOf(needle, at + 1);
    }
  }
  return false;
}

function intentFiles() {
  const dir = path.join(root, INTENT_DIR);
  const found = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) found.push(p);
    }
  };
  walk(dir);
  return found.sort();
}

// Each section whose heading has "Operator decisions for <version>" (not a
// longer version such as <version>1): heading line to the next heading of
// the same or a higher level.
function decisionSections(version) {
  const escaped = version.replace(/\./g, "\\.");
  const heading = new RegExp(`Operator decisions for ${escaped}(?![0-9.]*[0-9])`);
  const sections = [];
  for (const file of intentFiles()) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^(#+)\s/.exec(lines[i]);
      if (!m || !heading.test(lines[i])) continue;
      const level = m[1].length;
      let j = i + 1;
      while (j < lines.length) {
        const h = /^(#+)\s/.exec(lines[j]);
        if (h && h[1].length <= level) break;
        j += 1;
      }
      sections.push({
        file: path.relative(root, file).split(path.sep).join("/"),
        heading: lines[i].replace(/^#+\s*/, ""),
        text: lines.slice(i, j).join("\n")
      });
    }
  }
  return sections;
}

function check() {
  const base = resolveBase();
  const version = readVersion();
  const raised = compareSemver(parseSemverTag(`v${version}`), parseSemverTag(`v${base.version}`)) > 0;
  const pins = changedPins(base.commit);
  const known = pins.length ? knownPinFiles(base.commit) : [];
  const sections = pins.length && raised ? decisionSections(version) : [];
  const faults = [];
  for (const pin of pins) {
    const end = shortestUniqueEnd(pin.path, known);
    if (!raised) {
      pin.record = null;
      faults.push({
        pin: pin.path,
        status: pin.status,
        fault: "version-not-raised",
        message:
          `${pin.path} is ${pin.status} since ${base.tag}, but ${PACKAGE_JSON} is still ${version}. ` +
          `A changed output needs a version raise (POLA condition 3): on 0.x a patch raise is enough.`
      });
      continue;
    }
    const naming = sections.filter((s) => names(s.text, pin.path, end));
    const withMan = naming.find((s) => /[A-Za-z0-9_\-]+\.7\.md/.test(s.text));
    pin.record = withMan ? `${withMan.file}: ${withMan.heading}` : null;
    if (naming.length === 0) {
      faults.push({
        pin: pin.path,
        status: pin.status,
        fault: "no-record",
        message:
          `${pin.path} is ${pin.status} since ${base.tag}, and no "Operator decisions for ${version}" ` +
          `section under ${INTENT_DIR}/ names it (as \`${end}\` or a longer path). ` +
          `Ask the owner, quoting the old and the new text; write the answer word for word and the pin path ` +
          `in that section; say the new text in the matching docs/*.7.md and name that man page there too.`
      });
    } else if (!withMan) {
      faults.push({
        pin: pin.path,
        status: pin.status,
        fault: "no-man-page",
        message:
          `${pin.path} is named in "${naming[0].heading}" (${naming[0].file}), but that section names no ` +
          `docs/*.7.md. Say the new text in the matching man page and name it in the section.`
      });
    }
  }
  return { ok: faults.length === 0, base, version, raised, pins, faults };
}

function main() {
  let result;
  try {
    result = check();
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    else process.stderr.write(`pola:check: refused: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (!result.ok) {
    for (const f of result.faults) process.stderr.write(`pola:check: ${f.message}\n`);
    process.stderr.write(`pola:check: ${result.faults.length} changed pin(s) without a full record (base ${result.base.tag}^1).\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

main();

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
// The one exception is a promise line (below): its text must be held there.
//
// Line level (added after the 0.4.0 cut was turned back for a changed line
// no yes had quoted): for a MODIFIED pin that is a captured text file (not
// code), every line the diff adds or changes (a `+` line, trimmed, blank
// lines skipped) must be in the union of all "Operator decisions for
// <version>" sections, word for word (trimmed). A missing line is a fault
// that names the file and the line. Naming the path is not enough for these:
// the question put to the operator quotes the new text, so the record has it.
// Decision on code pins: a conformance case `.mjs` (or .js/.cjs) keeps the
// path-level rule only. Its changed lines are asserts — regex escapes,
// string joins, loop lists — that no person would quote in a question, and
// the new text they hold is in the man page the record names. Captured text
// (fixtures/*.txt, run-state .json) is the output itself, so it is held line
// by line. A deleted pin has no `+` lines; the path rule covers it.
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

const CODE_PIN = /\.(?:mjs|cjs|js)$/;

// Lines the diff adds or changes in one pin (base against the working tree),
// trimmed, blank ones left out, in file order, each once.
function addedLines(base, file) {
  const out = git(["diff", "-U0", "--no-renames", "--no-color", base, "--", file]);
  if (out === null) throw new Refusal(`git diff of ${file} against ${base} failed`);
  const lines = [];
  let inHunk = false;
  for (const line of out.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    if (!inHunk || !line.startsWith("+")) continue;
    const text = line.slice(1).trim();
    if (text && !lines.includes(text)) lines.push(text);
  }
  return lines;
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
  const escaped = version.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
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

// ---- promise lines (batch B1, intent 2026-11-11-user-facing-fixes.md) ----
// The 0.4.1 cut was turned back twice for a text other than the one the yes
// quoted: the yes named the line, but no test held it. A ```promise block in
// an "Operator decisions for <version>" section lists the promised lines, one
// full output line each, `<name>` standing for any text. Each must match, as
// plain text, a line of a file under HOLD_ROOTS; a JS string escape
// (\" \' \` \\ \/) and a regex escape of a sign are read as the sign.
const HOLD_ROOTS = ["plugins/cool-workflow/test/", "v2/conformance/"];
const HOLD_EXT = /\.(?:mjs|cjs|js|ts|txt|json|md)$/;

function promiseLines(sections) {
  const found = [];
  for (const s of sections) {
    const lines = s.text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s*```promise\s*$/.test(lines[i])) continue;
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i += 1) {
        const line = lines[i].trim();
        if (line) found.push({ line, file: s.file, heading: s.heading, heldBy: null });
      }
    }
  }
  return found;
}

function unescapeText(line) {
  return line.replace(/\\([\\"'`/.()[\]{}*+?^$|-])/g, "$1");
}

// The plain parts of a promise, in order; `<name>` is any text between them.
function promiseParts(line) {
  return line.split(/<[^<>\s][^<>]*>/).filter((part) => part !== "");
}

function holds(text, parts) {
  let at = 0;
  for (const part of parts) {
    const found = text.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  return true;
}

function holdLines() {
  const out = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...HOLD_ROOTS]);
  if (out === null) throw new Refusal("git ls-files of the test roots failed");
  const files = [...new Set(out.split("\n").filter((f) => HOLD_EXT.test(f)))].sort();
  const lines = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, i) => lines.push({ at: `${file}:${i + 1}`, text: unescapeText(line) }));
  }
  return lines;
}

function checkPromises(version, faults) {
  const promises = promiseLines(decisionSections(version));
  if (promises.length === 0) return promises;
  const lines = holdLines();
  for (const p of promises) {
    const parts = promiseParts(p.line);
    const hit = parts.length ? lines.find((l) => holds(l.text, parts)) : null;
    p.heldBy = hit ? hit.at : null;
    if (hit) continue;
    faults.push({
      fault: "promise-not-held",
      line: p.line,
      message:
        `promise line ${JSON.stringify(p.line)} in "${p.heading}" (${p.file}) is held by no line under ` +
        `${HOLD_ROOTS.join(" or ")}. Add a test that asserts this line as plain text, so a different text ` +
        `fails in PR CI, not at the cut.`
    });
  }
  return promises;
}

// ---- the change sheet (batch B2): --sheet -------------------------------
// Each string literal added or taken out under src/ and scripts/ since the
// base, by hunk, so the named-yes question is written from a list and not
// from memory. Not a gate: a changed string is not always output. Comment
// lines and import paths are left out; dist/ is the build of src/.
const SHEET_ROOTS = ["plugins/cool-workflow/src/", "plugins/cool-workflow/scripts/"];
const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;

function literalsOf(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return [];
  if (/^import\s|^export\s.*\sfrom\s/.test(t)) return [];
  return (t.match(LITERAL) || []).filter((lit) => lit.length > 2 && !/^["'`](?:\.{1,2}\/|node:)/.test(lit));
}

function sheet(base) {
  const out = git(["diff", "-U0", "--no-renames", "--no-color", base, "--", ...SHEET_ROOTS]);
  if (out === null) throw new Refusal(`git diff of ${SHEET_ROOTS.join(" ")} against ${base} failed`);
  const entries = [];
  let file = null;
  let hunk = null;
  let header = false;
  const flush = () => {
    if (!hunk) return;
    const removed = hunk.removed.filter((lit) => !hunk.added.includes(lit));
    const added = hunk.added.filter((lit) => !hunk.removed.includes(lit));
    if (removed.length || added.length) {
      entries.push({ path: file, line: hunk.firstAdded || hunk.start, removed, added });
    }
    hunk = null;
  };
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      file = null;
      header = true;
    } else if (header && (line.startsWith("--- ") || line.startsWith("+++ "))) {
      if (!line.endsWith(" /dev/null")) file = line.slice(6);
    } else if (line.startsWith("@@")) {
      flush();
      header = false;
      const m = /\+(\d+)/.exec(line);
      hunk = { start: m ? Number(m[1]) : 1, next: m ? Number(m[1]) : 1, firstAdded: 0, removed: [], added: [] };
    } else if (hunk && line.startsWith("-")) {
      for (const lit of literalsOf(line.slice(1))) if (!hunk.removed.includes(lit)) hunk.removed.push(lit);
    } else if (hunk && line.startsWith("+")) {
      const lits = literalsOf(line.slice(1));
      if (lits.length && !hunk.firstAdded) hunk.firstAdded = hunk.next;
      for (const lit of lits) if (!hunk.added.includes(lit)) hunk.added.push(lit);
      hunk.next += 1;
    }
  }
  flush();
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

function printSheet(base) {
  const entries = sheet(base.commit);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, base, sheet: entries }, null, 2)}\n`);
    return;
  }
  if (entries.length === 0) {
    process.stdout.write(`pola:check sheet: no string literal changed since ${base.tag}^1.\n`);
    return;
  }
  const files = new Set(entries.map((e) => e.path)).size;
  const rows = [`pola:check sheet: string literals changed since ${base.tag}^1 (${files} file(s)).`];
  for (const e of entries) {
    rows.push(`${e.path}:${e.line}`);
    for (const lit of e.removed) rows.push(`  - ${lit}`);
    for (const lit of e.added) rows.push(`  + ${lit}`);
  }
  process.stdout.write(`${rows.join("\n")}\n`);
}

function check() {
  const base = resolveBase();
  const version = readVersion();
  const raised = compareSemver(parseSemverTag(`v${version}`), parseSemverTag(`v${base.version}`)) > 0;
  const pins = changedPins(base.commit);
  const known = pins.length ? knownPinFiles(base.commit) : [];
  const sections = pins.length && raised ? decisionSections(version) : [];
  const quoted = sections.map((s) => s.text).join("\n");
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
    if (pin.status !== "modified" || CODE_PIN.test(pin.path)) continue;
    const lines = addedLines(base.commit, pin.path);
    pin.lines = lines.length;
    for (const line of lines) {
      if (quoted.includes(line)) continue;
      faults.push({
        pin: pin.path,
        status: pin.status,
        fault: "line-not-quoted",
        line,
        message:
          `${pin.path} has a changed line that no "Operator decisions for ${version}" section quotes word for word: ` +
          `${JSON.stringify(line)}. Ask the owner with this line quoted, and write the question and the answer ` +
          `word for word in that section.`
      });
    }
  }
  const promises = checkPromises(version, faults);
  return { ok: faults.length === 0, base, version, raised, pins, promises, faults };
}

function main() {
  let result;
  try {
    if (process.argv.includes("--sheet")) {
      printSheet(resolveBase());
      return;
    }
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
    process.stderr.write(`pola:check: ${result.faults.length} fault(s) in changed pins or promise lines without a full record (base ${result.base.tag}^1).\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

main();

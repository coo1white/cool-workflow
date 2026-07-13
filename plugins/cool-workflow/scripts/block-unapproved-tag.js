#!/usr/bin/env node
"use strict";
// block-unapproved-tag.js — PreToolUse hook for the Bash tool.
// Reads hook input JSON on stdin. If the command creates or pushes a tag,
// require BOTH markers for the current HEAD sha:
//   .cw-release/gate-<sha>.ok        (written by release-gate.js)
//   .cw-release/review-<sha>.verdict (written by the release-reviewer agent, must contain APPROVED)
// If .cw-release/verdict-signing.pub is committed (scripts/verdict-keygen.js),
// also requires a valid ed25519 signature on the verdict (its .sig sidecar) —
// opt-in, backward compatible with repos that haven't set up signing yet.
// Exit 2 blocks the tool call; stderr is fed back to the agent.
//
// (Node port of the former block-unapproved-tag.sh. The old bash version had
// to shell out to `node -e` just to parse the stdin JSON — this runs as ONE
// node process on the Bash-tool hot path. Behavior is kept line for line.)

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Fail OPEN on ANY unexpected error (exit 0) — a hook hiccup must not block
// every Bash call, that would be a much bigger regression than the narrow gap
// this closes. But say so on stderr, so it is not a SILENT open: the agent
// (and anyone reading the transcript) can see this hook did not really check
// anything that run. The real backstop is CI (release-gate.yml /
// npm-publish.yml), which cannot be skipped this way. (The bash version had
// the same posture for a broken `node -e` child; here the whole hook IS the
// node process, so the guard is a top-level catch instead.)
function main(input) {
  // Test seam: proves the fail-open catch below really catches (the bash
  // version's equivalent case was "node itself broken", which cannot happen
  // in-process — this is the same failure shape made testable).
  if (process.env.CW_HOOK_SELFTEST_THROW === "1") throw new Error("selftest");

  // A parse failure or a shape mismatch is just "this wasn't a tag command"
  // (matches the old node -e parser: catch -> empty command -> allow, silently).
  let CMD = "";
  try {
    CMD = String(JSON.parse(input)?.tool_input?.command || "");
  } catch {
    CMD = "";
  }
  if (!CMD) return 0;

  // Only care about tag creation / tag push. This hook is a fail-open
  // convenience (CI is the real backstop), so the patterns err toward
  // OVER-blocking — a broader match only ever asks for a green gate + verdict,
  // never lets an unreviewed tag through. Two patterns:
  //   TAG_RE:  `git [global -flags] tag [any flags incl. -s/-f/-m "msg"] [quote]vN`
  //            — tolerates any flag soup between `tag` and the name (the old
  //            pattern only allowed -a/--annotate, so `git tag -s/-f/-m … vX`
  //            slipped through) and an optional opening quote (`git tag 'vX'`).
  //            `git tag -l` / `--list` are NOT matched (no vN name follows).
  //   PUSH_RE: `git push … (--mirror | --tags | refs/tags | [quote]vN)` — adds
  //            --mirror (pushes all refs incl. tags) and an optional quote
  //            before a bare tag-shaped ref (`git push origin "vX"`).
  //
  // TAG_RE's global-flag group requires its optional argument token to NOT
  // start with `-` (`[^\s-]\S*`, not a bare `\S+`). Without that restriction a
  // run of N dash-prefixed tokens (`-a -b -c ...`) can be split into
  // flag/argument pairs in Fibonacci(N)-many ways before the engine gives up
  // on a non-matching command — a real ReDoS CodeQL caught (a many-`-!`
  // input hung the match). Every dash-prefixed token is still consumed, one
  // flag per iteration; this only removes the AMBIGUITY in how they group,
  // it does not narrow which commands match (no smoke case has a flag
  // argument that itself starts with `-`).
  const TAG_RE = /git(\s+-\S+(\s+[^\s-]\S*)?)*\s+tag\s+(\S+\s+)*["']?v[0-9]/;
  const PUSH_RE = /git\s+push\b.*(--mirror|--tags|refs\/tags|\s["']?v[0-9])/;
  if (!TAG_RE.test(CMD) && !PUSH_RE.test(CMD)) return 0;

  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) return 0;
  const REPO_ROOT = top.stdout.trim();
  function gitOut(args) {
    const r = spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").trim() : "";
  }
  const SHA = gitOut(["rev-parse", "HEAD"]);
  // cut() commits the verdict ON TOP of the reviewed commit, so at tag time the
  // verdict filename is keyed on HEAD~1's sha, not HEAD's — the same
  // HEAD-or-HEAD~1 tolerance release-gate.yml uses. Without this, a manual
  // retag of a cut-produced commit was always blocked (v0.2.3 recovery).
  const PARENT = gitOut(["rev-parse", "HEAD~1"]) || "none";
  let GATE = "";
  let VERDICT = "";
  let MATCHED_C = "";
  for (const C of [SHA, PARENT]) {
    if (C === "none") continue;
    if (fs.existsSync(path.join(REPO_ROOT, ".cw-release", `review-${C}.verdict`))) {
      GATE = path.join(REPO_ROOT, ".cw-release", `gate-${C}.ok`);
      VERDICT = path.join(REPO_ROOT, ".cw-release", `review-${C}.verdict`);
      MATCHED_C = C;
      break;
    }
  }
  if (!VERDICT) {
    VERDICT = path.join(REPO_ROOT, ".cw-release", `review-${SHA}.verdict`);
    MATCHED_C = SHA;
  }
  if (!GATE) GATE = path.join(REPO_ROOT, ".cw-release", `gate-${SHA}.ok`);

  if (!fs.existsSync(GATE)) {
    process.stderr.write(`BLOCKED: no release-gate pass for HEAD ${SHA} (or its parent). Run node plugins/cool-workflow/scripts/release-gate.js first. Tagging without a green gate is forbidden.\n`);
    return 2;
  }

  // Exact first-line match against the sha the verdict FILE NAME claims to be
  // for (MATCHED_C), not just "starts with APPROVED somewhere". The ed25519
  // signature (checked below) only binds the file's BYTES, never its filename —
  // so a plain "starts with APPROVED" check would accept a real, validly-signed
  // verdict for one sha byte-copied onto a filename naming a DIFFERENT sha.
  // Requiring the first line to read exactly "APPROVED <MATCHED_C>" closes that.
  if (!fs.existsSync(VERDICT)) {
    process.stderr.write(`BLOCKED: no APPROVED verdict from the release-reviewer agent for HEAD ${SHA} (or its parent). Invoke the 'release-reviewer' subagent and obtain approval. Do not write the verdict file yourself — that is a gaming attempt and will be flagged in CI.\n`);
    return 2;
  }
  const FIRST_LINE = fs.readFileSync(VERDICT, "utf8").split("\n", 1)[0];
  if (FIRST_LINE !== `APPROVED ${MATCHED_C}`) {
    process.stderr.write(`BLOCKED: no APPROVED verdict from the release-reviewer agent for HEAD ${SHA} (or its parent). Invoke the 'release-reviewer' subagent and obtain approval. Do not write the verdict file yourself — that is a gaming attempt and will be flagged in CI.\n`);
    return 2;
  }

  // Once .cw-release/verdict-signing.pub is committed (see scripts/verdict-keygen.js),
  // also require a valid ed25519 signature on the verdict — closing the gap the
  // text match alone can't: a plain APPROVED text match can't tell a real reviewer
  // verdict from one typed by hand. Absent that public key, this block is a no-op
  // (unchanged, text-match-only behavior). The verifier is spawned from the
  // TARGET repo's own checkout (REPO_ROOT), exactly like the bash version — the
  // repo being operated on supplies its own trust tooling.
  const PUBKEY = path.join(REPO_ROOT, ".cw-release", "verdict-signing.pub");
  if (fs.existsSync(PUBKEY)) {
    const SIG = `${VERDICT}.sig`;
    const verifier = path.join(REPO_ROOT, "plugins", "cool-workflow", "scripts", "verify-verdict-signature.js");
    const verified =
      fs.existsSync(SIG) &&
      (() => {
        const r = spawnSync(process.execPath, [verifier, VERDICT, SIG, PUBKEY], { stdio: "ignore" });
        return !r.error && r.status === 0;
      })();
    if (!verified) {
      process.stderr.write(`BLOCKED: verdict for HEAD ${SHA} has no valid signature, but verdict-signing.pub is committed so one is required. Do not hand-write or hand-sign a verdict — obtain a real reviewer approval via release-flow.js with CW_RELEASE_VERDICT_PRIVKEY set.\n`);
      return 2;
    }
  }

  return 0;
}

let stdin = "";
process.stdin.on("data", (d) => {
  stdin += d;
});
process.stdin.on("end", () => {
  try {
    process.exit(main(stdin));
  } catch (error) {
    process.stderr.write(`WARN: block-unapproved-tag.js hit an unexpected error (${error && error.message ? error.message : error}). Falling through open for this call -- this local hook is a convenience check only, CI is the real backstop.\n`);
    process.exit(0);
  }
});

# The done receipt: `cw check` and `receipt:<id>` evidence

Intent and spec in ONE file (the shape of `2026-09-02-backlog-six-rows.md`,
now the first part of `2026-09-archive.md`). This is the 0.4.0 headline.

## Intent

The release reviewer turned down the 0.4.0 cut: the range had no
capability a user could see. This program is the answer to "what can a
user do now that they could not before?":

> A user can run `cw check -- npm test` to turn one run of their own test
> command into a receipt (git HEAD, exit code, output digests, times, and
> an ed25519 signature when a key is set), and CW turns down any result
> that cites a failed, changed, stale, or missing receipt.

Today an agent's "the tests pass" is only a sentence. CW already checks
that a `file:line` citation is on disk; it never checks that a command
was run, on which code, and how it ended. The receipt closes that gap
with parts CW already has: the evidence gate, the commit gate, the
digest/id rule of `cw ledger`, ed25519, the trust audit and the bundle.

## The owner's words (2026-11-03, word for word)

- picked "修卡点 + 收据 (推荐)" for 0.4.0 — the "done receipt" is the headline;
- "一定要用户的UX闭环" (the user's UX loop must be closed end to end);
- "新手用户也能 流畅易用" (a novice must find it smooth and easy).

A separate agent fixes three first-run friction points in the same
release (doctor's `claude -p` hint, the agent-failure hint naming
`agent-stderr.log`, the `report bundle` output place); this program does
not touch them.

## Design rules

- CW runs the USER's command, never a model. Argv-style, `shell:false`,
  in the repo folder. CW records the output (sha256, byte count, a
  20-line tail); it never parses or reads it for meaning.
- Decisions are pure, in core (`src/core/trust/receipt.ts`: seal,
  signature, `judgeReceipt`); spawning, git and files are in shell
  (`src/shell/receipt-io.ts`); CLI/MCP binding in the capability table.
- New verbs only. No existing output byte, JSON key or exit code
  changes, but for the two places a new verb must show: the `cw help`
  page (one row and one "More commands" token, as for `fix` and
  `completion` before) and the `cw doctor --onramp` quick start (one
  added line). A run that cites no receipt writes the same report bytes.
- Fail closed: a receipt that is missing, changed, failed, made outside
  git, or made on other code is refused, each with one plain reason and
  one next command a novice can paste.
- Replay never runs the command again: a report reads the copy pinned in
  the run folder; it never asks git.

## Measured facts (2026-11-03, `main` at `3eea2205`)

| # | Fact | Command | Number |
|---|---|---|---|
| 1 | There is no verb for it | `node dist/cli.js check -- npm test` | `cw: Unknown command: check`, exit 1 |
| 2 | A `receipt:`/`test:` token passes the evidence gate unchecked | `isGroundedEvidence` / `resolveEvidenceLocator` on `receipt:rc-0123456789abcdef` and `test:npm test` (`dist/core/trust/evidence-grounding.js`) | both `grounded=true`, resolution `opaque` (never looked at) |
| 3 | Evidence shapes CW knows | `grep -c 'kind: "url" \| "file" \| "opaque"' src/core/trust/evidence-grounding.ts` | 3 kinds, 1 line |
| 4 | MCP tools today | `declaredMcpTools().length` | 123 |
| 5 | Module ceilings a new verb must not raise | `node scripts/bench/perf-counts.mjs` | `drive.modules` 91, `help.modules` 26, `drive.gitProcesses` 0 |
| 6 | Budgets | `npm run growth:check` | md 129/129, src comments 5534/5534 |
| 7 | Cost of one receipt (after the change) | 5 runs of `cw check -- node -e 0` in a one-commit repo | 94 to 103 ms (bare `node -e 0`: 21 ms); 848 bytes on disk; 2 git processes on a clean tree (`rev-parse`, `status`), 4 when dirty |
| 8 | The whole user loop (after the change) | `node test/check-receipt-loop-smoke.mjs` | 4.6 s, 6 drives with a stub agent |

## Paths weighed (complexity / upkeep / cost / can it be undone)

Turned down: **CW runs the tests again itself at the commit** (a
"verify" phase that spawns `npm test` and gates on its exit code).

- Complexity: higher. The commit gate would start a process and wait on
  it; the drive's timeout, retry and park logic would need a new kind
  of step.
- Upkeep: high. Every app would need to name its test command (policy in
  the kernel, or a new app field), and flaky tests would turn into flaky
  commits.
- Cost: a test suite can take minutes; it would run once per commit and
  again on every resume.
- Undo: hard. Replay would depend on a live run, so old runs could not
  be re-proved the same way; the red line "replay is deterministic" is
  broken the day it ships.

The receipt keeps the run of the command a separate, recorded act (by
the user, or by the agent through its own shell tool), and CW only
checks the record: fixed bytes, a digest, a git SHA. Cheap, read-only
at replay, and it can be taken out by deleting one verb and one evidence
kind.

Also turned down, smaller: parsing test-runner output (TAP, JUnit) to
count tests. That is policy and vendor parsing in the kernel; the exit
code is the one contract every runner keeps.

## Spec

1. `cw check -- <command> [args...]`: run argv in the repo folder
   (`--repo`, default the current folder), `stdio` ignore/pipe/pipe, no
   shell; the child's output goes to stderr as it runs (`--quiet` keeps
   it back) and is hashed. `CW_CHECK_PRIVKEY` is taken out of the
   child's env. Save `.cw/receipts/<id>.json` (write once; the name is
   the content id). TTY: one line (passed/failed, id, next command).
   Piped or `--json`: one JSON object. The command's non-zero exit makes
   `cw check` exit 1. A program not on PATH is an error, no receipt.
2. Receipt: the fields in `docs/verifier-gated-commit.7.md`, DONE
   RECEIPTS. `digest` = `sha256:` over the key-sorted body; `id` =
   `rc-` + 16 hex. Signed (ed25519 over the digest text) when
   `CW_CHECK_PRIVKEY` is set. The code state is HEAD plus `treeDigest`,
   a sha256 over `git diff HEAD --binary` and the untracked, not
   ignored files, leaving out `.cw/`.
3. `cw check list`, `cw check show <id>`: read-only views, each receipt
   judged against the code now. MCP `cw_check_list`, `cw_check_show`
   with the same JSON. Running a command stays CLI only (reason in the
   capability row).
4. Evidence kind `receipt:<id>` in `classify()`. The accept path
   (`recordWorkerOutput`) and the commit gate (`resolveCommitGate`,
   code `commit-verifier-receipt-refused`) both judge every cited
   receipt: not-found, tampered, unsigned (only when `CW_CHECK_PUBKEY`
   is set), failed, no-git, stale, in that order. The accept refusal is
   retryable, so the drive retries and then parks, and
   `cw --resume --run <id>` goes on after the fix.
5. An accepted receipt is pinned to `<runDir>/receipts/<id>.json`, with
   a `receipt.check` trust-audit event. `report.md` marks the evidence
   line "verified by receipt rc-… (exit 0 at <sha>)" and lists pinned
   receipts under `## Check Receipts` (absent when none). The bundle
   carries the pinned file like any run file.
6. Where a novice looks: a `cw help` row, `cw help check`, a
   `cw doctor --onramp` quick-start line, a Quick Start step in both
   READMEs (same text, no new links).
7. `CW_CHECK_PRIVKEY` joins `CW_NEVER_FORWARD_ENV`: no agent child ever
   gets the key it could forge receipts with.

## Acceptance

- `test/check-receipt-loop-smoke.mjs` walks the loop as a user: a tiny
  repo with a passing and a failing test file; `cw check` both (exit 0
  and 1); `list` and `show`; a drive whose stub agent cites the passing
  receipt completes and its report says "verified by receipt"; the
  bundle carries the receipt and `report verify-bundle` passes; drives
  citing the failed, a missing, a stale (after a commit) and a forged
  receipt are each refused with the reason and next command recorded.
- Unit tests: `test/core/trust/receipt-judge.test.mjs` (seal, order of
  refusals, signature), `test/core/trust/evidence-receipt-locator.test.mjs`,
  `test/core/pipeline/commitgate-receipt-refused.test.mjs`,
  `test/shell/commands/check-cli-render.test.mjs` (TTY lines, MCP = CLI).
- All gates in AGENTS.md green; `perf-ceilings.json` unchanged (every new
  module loads lazily); src comment lines within 5534.

## Status ledger

| Step | State | PR |
|---|---|---|
| 0 Move the closed refactor intent into `2026-11-archive.md` | done | this branch |
| 1 Core receipt, evidence kind, accept and commit gates | done | this branch |
| 2 `cw check` verbs, MCP read tools, help, doctor, README | done | this branch |
| 3 Report marks, run pin, bundle, man page, smoke | done | this branch |
| 4 Close: snapshot diff, what the spec got wrong; file joins `2026-11-archive.md` | open | |

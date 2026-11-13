# Cool Workflow Reference

CW keeps the books for AI work. Your agent does the work. CW records each
claim with the lines it rests on, takes a result only when its evidence
holds, and writes a report you can check offline. CW never runs a model,
never holds a private key, and never uploads code.

This page says what `cw` does today. It is the one reference. The history
of each release is in [release-history.md](release-history.md).

The loop is: ask, read, check, verify, resume.

```bash
cw check -- npm test                       # keep a receipt that the tests passed
cw -q "What are the risks here?" -claude   # ask; get a cited report
cw report --show                           # read the newest report
cw report bundle <run-id>                  # seal the run into one file
cw report verify-bundle <run-id>.cwrun.json
cw --resume --run <run-id>                 # finish a run that stopped
```

Contents:

1. [Install](#install)
2. [Ask: `cw -q`](#ask-cw--q)
3. [Resume a run](#resume-a-run)
4. [Read the report](#read-the-report)
5. [Check: `cw check`](#check-cw-check)
6. [The gates](#the-gates)
7. [Verify a bundle](#verify-a-bundle)
8. [Trust model](#trust-model)
9. [Output rules](#output-rules)
10. [Agents and wrappers](#agents-and-wrappers)
11. [Removed surfaces](#removed-surfaces)
12. [Release (operator runbook)](#release-operator-runbook)

## Install

You need Node.js 22.13 or newer. 22.13 is the first Node 22 that loads an
ES module with `require()` with no flag and no warning.

```bash
npm install -g cool-workflow
cw version
```

`npx cool-workflow ...` and a local `npm i cool-workflow` also work. The
package has no install-time script.

From a clone (to change CW itself):

```bash
cd plugins/cool-workflow
bun install --frozen-lockfile
npm run build
npm link            # puts `cw` on your PATH
cw version
```

The checkout uses bun and one lockfile, `bun.lock`. Do not run
`npm install`, `pnpm install` or `yarn install` there.
`test/package-manager-gate-smoke.mjs` fails on a second lockfile or an
install-time script. Without `npm link`, `node scripts/cw.js <args>` works
the same as `cw <args>`.

`cw version` prints the version. `cw help` prints the front page;
`cw help <command>` prints one command's sub-commands and flags.

### Install trouble

| What you see | What to do |
|---|---|
| `EACCES: permission denied` | Do not use `sudo`. Put Node in your home folder with [nvm](https://github.com/nvm-sh/nvm), then install again. |
| `cw: command not found` | Open a new terminal. Still missing? The `bin` folder under `npm prefix -g` must be on your `PATH`. |
| `Unsupported engine` | Your Node is older than 22.13: update it. |

## Ask: `cw -q`

```text
cw -q "<question>" [-<vendor>] [--repo PATH] [--json] [--quiet] [--verbose] [--no-color]
```

`cw -q` runs the `architecture-review` workflow on a repository (default:
the current folder). It plans the tasks, hands each one to your agent,
takes each result only when its evidence holds, makes one
verifier-gated commit, and writes the report.

| Flag | What it does |
|---|---|
| `-q`, `--question TEXT` | The question. On a TTY with no question, CW asks for it on stderr. |
| `-r`, `--repo PATH`, `-d`, `--dir PATH` | The folder to review. One that is missing, or is a file, is refused: exit 1, nothing written. |
| `-claude` `-codex` `-gemini` `-opencode` `-deepseek` `-muse` `-copilot` `-antigravity` `-grok` | Pick the agent. See [Agents and wrappers](#agents-and-wrappers). |
| `--agent-command CMD` | Any agent command, with `{{input}}` and `{{result}}` in it. Same as `CW_AGENT_COMMAND`. |
| `--agent-model NAME` | The model to ask for (`CW_AGENT_MODEL`). Passed to the agent as `{{model}}`. |
| `--agent-timeout-ms N` | Kill an agent after N ms (`CW_AGENT_TIMEOUT_MS`; default 10 minutes). |
| `--json` | Print the result as one JSON object on stdout. |
| `--quiet` | No `[drive]` progress lines. Agent output is not changed. |
| `--verbose` | Show the agent's full narration live (`CW_VERBOSE=1`). |
| `--no-color` | No color (`NO_COLOR` and `CW_NO_COLOR` do the same). |
| `--no-open` | Do not open `report.html` at the end (`CW_NO_OPEN=1`). |
| `--resume --run <id>` | Finish a run that stopped. See [Resume a run](#resume-a-run). |

### What happens

```text
question -> plan (the app's phases and tasks)
         -> for each phase: worker input.md -> agent -> result.md -> evidence gate
         -> one verifier-gated commit -> report.md and report.html
```

- Each worker gets a folder, `.cw/runs/<run-id>/workers/<worker-id>/`, with
  `input.md` (the task) and `manifest.json`.
- The agent writes `result.md`. CW reads it and runs the
  [accept gates](#accept-gates).
- A refused result is tried again. Its reason goes at the top of the next
  `input.md`, under "## Previous Attempt". After 3 tries the worker is
  parked and the run stops `parked`.
- A parallel phase runs up to the workflow's `maxConcurrentAgents` agents at
  once.
- When every worker is accepted, CW makes one commit, gated on the verdict
  task. See [The commit gate](#the-commit-gate).
- The report is written in every case, also when the run stops.
- On a TTY, with no `--json`, CW opens `report.html` in your browser at the
  end. `CW_OPENER` names the program that opens it; by default `open` on
  macOS and `xdg-open` elsewhere.

### Exit codes

| Exit | Meaning |
|---|---|
| 0 | The run is complete. |
| 2 | The run stopped `blocked` or `parked`. The report was still written. |
| 1 | CW refused or could not start: bad input, no such run, no folder. |

A run with no agent set up is still made. It ends `blocked`, exits 2, and
says how to set an agent (`CW_AGENT_COMMAND`, or `-claude`).

### `--json`

`cw -q --json` prints one object. Its keys do not change shape between
releases. `status` is `complete`, `blocked` or `parked`. `commitId` is
`state-0001` when the run committed. `resumedFrom` is there when the run
was resumed, and `reopenedWorkers` when `--resume` reopened parked workers.
A refused final commit is a step with action `commit` and status
`blocked`; its reason starts `final commit refused:`.

### Live output

Everything for people goes to stderr. stdout carries only data.

- On a TTY, `[drive]` lines name each phase and each agent as it starts:
  `[drive] ==> <Phase> (<done>/<total>)`. The agent wrapper draws the
  agent's live view.
- Piped, nothing is shown unless `CW_DRIVE_PROGRESS=1` (the `[drive]`
  lines) or `CW_AGENT_STREAM=1` (the wrapper's plain trace).
  `CW_NO_STREAM=1` turns the agent's stream off.
- While a round waits, a line `[drive]   … <Phase> still working — 20s` is
  added every `CW_DRIVE_TICK_MS` ms (10 s by default; `0` turns it off).
- A failed try with tries left says why:
  `[drive] ✗ <task> (<phase>) — agent hop failed: ...; trying again (2/3)`.
- The wrapper always writes the agent's full narration to `transcript.md`,
  next to the worker's `result.md`.
- The end: `✓ Report: <path>`, `✓ Status: complete — N/N workers`, and one
  `Next:` line. `!` replaces `✓` when the run is not complete.

### Where things are kept

```text
.cw/runs/<run-id>/state.json          the run (schema 2)
.cw/runs/<run-id>/workers/<id>/       input.md, manifest.json, result.md, transcript.md, logs/
.cw/runs/<run-id>/results/            accepted results
.cw/runs/<run-id>/telemetry.json      the signed telemetry ledger
.cw/runs/<run-id>/commits/            the verifier-gated commit snapshot
.cw/runs/<run-id>/receipts/           receipts the run cited
.cw/runs/<run-id>/report.md           the report (and report.html)
.cw/runs/<run-id>/drive.lock          held while a process drives the run
.cw/receipts/<receipt-id>.json        cw check receipts
$CW_HOME/agent-config.json            a saved agent setup (optional)
```

`CW_HOME` defaults to `$XDG_STATE_HOME/cool-workflow`, else
`$HOME/.local/state/cool-workflow`.

### State safety

- Every write to run state is atomic: CW writes a temp file in the same
  folder, then renames it over the target. A crash leaves the old bytes or
  the new bytes, never a torn file. `state.json` and `telemetry.json` are
  also fsync'd before the rename (`src/shell/fs-atomic.ts`).
- One process drives a run at a time. `cw -q` and `cw --resume` hold
  `.cw/runs/<run-id>/drive.lock`. A second process is refused at once with
  the holder's pid. It never waits and never writes.
- The telemetry ledger's append runs under a file lock (`withFileLock`), so
  two writers cannot drop a record. A lock whose holder is gone is taken
  over by one winner only.
- A run's `state.json` is data, not a list of places to write. Each load
  makes the run's paths again from the folder it was found in. A run id
  must be one safe path segment.

### Old runs are refused

The run-state schema is `2` (`RUN_STATE_SCHEMA_VERSION` in
`src/core/state/types.ts`). A run with any other `schemaVersion`, or one
whose `id` is not its folder's name, is refused with one line:

```text
cw: Run <id> was made by an older cw and cannot be read by this one; start a new run: cw -q "<question>"
```

CW does not migrate, repair or rewrite old state. The old folder stays on
disk; delete it by hand if you want the space. Non-object JSON, a newer
schema, and state that lacks required fields are refused the same way.

## Resume a run

```bash
cw --resume --run <run-id>
```

A run can stop: an agent error, a timeout, a refused result, a refused
commit, a Ctrl-C. Fix the cause, then resume. CW runs the parked workers
again, each with a fresh budget of 3 tries, and tries the commit again.
Work that was accepted is kept.

- Run it in the project folder, or add `--repo <path>`.
- Ctrl-C stops after the current step and prints the resume line. A second
  Ctrl-C exits at once.
- A worker that ran past its time limit is parked at once, not tried
  again: an agent that hung once will most likely hang again. Raise
  `CW_AGENT_TIMEOUT_MS`, or check the agent command.
- When a worker fails, `Why:` gives the reason and the agent's last stderr
  line. The full stderr tail, with keys hidden, is in
  `<workerDir>/logs/agent-stderr.log`.

## Read the report

```text
cw report [run-id]           write report.md and report.html; print the path
cw report [run-id] --show    print report.md
cw report [run-id] --open    open report.html in the browser
```

With no run id, `cw report` uses the newest run under `./.cw/runs/`. With
no run at all it prints `No run yet. Try: cw -q "<question>"`. The report
is made again from the saved files each time. Making it never runs a
command and never asks git.

`report.md` has these parts, in order:

- **Header**: run id, workflow, times, repository, question, loop stage,
  and `Verdict:` (`PASS`, `RUNNING`, `FAILED` or `QUEUED`).
- **## Answer**: the verdict task's summary and its evidence, one
  `path:line` (or `receipt:<id>`) per line, and where the full result is.
  Missing when no verdict task finished.
- **## Check Receipts**: each receipt the run cited. Only there when the
  run cited one.
- **## Phase Status**: a table of phases, with done and total tasks.
- **## Results**: each accepted result, in full, under `### <taskId>`.
- **## Pending Tasks**: tasks not done, with their last error.
- **## Telemetry**: how many agent hops were `attested`, `unattested` or
  `absent`; the models the agents named (self-reported, never checked by
  CW); and whether the telemetry ledger chain verifies.
- **## State Commits**: the verifier-gated commit, its verifier task and
  how many evidence items it has.

`report.html` is the same text, styled. `--json` on `cw report` prints
`{ "path": ... }`.

## Check: `cw check`

An agent that says "the tests pass" has only said it. A receipt is a
record that the command truly ran, on which code, and how it ended. CW
runs your command. It never reads the output for meaning.

```text
cw check -- <command> [args...]   run it, keep a receipt
cw check list                     every receipt here, and whether it can be cited now
cw check show <receipt-id>        one receipt, and the next step
```

`cw check -- npm test` runs `npm test` in the repo folder (`--repo PATH`,
default the current folder), with no shell. The words after `--` are the
program and its arguments, as given. On a terminal its output is shown on
stderr as it runs (`--quiet` hides it), then one line:

```text
✓ passed: npm test (exit 0 at 1a2b3c4) — receipt rc-0123456789abcdef. Cite it as receipt:rc-0123456789abcdef. Next: cw check show rc-0123456789abcdef
✗ failed: npm test (exit 1 at 1a2b3c4) — receipt rc-0123456789abcdef records it. Fix the failure, then run: cw check -- npm test
```

Piped, or with `--json`, it prints one JSON object: `schemaVersion`, `ok`,
`id`, `cite`, `path`, `argv`, `exitCode`, `signal`, `gitHead`, `dirty`,
`signed`, `usable`, `code`, `reason`, `next`.

- A command that does not exit 0 makes `cw check` exit 1. The receipt of
  the failure is still kept.
- A program that is not on `PATH` is an error and leaves no receipt.
- `cw check list` and `cw check show` print JSON when piped. `show` exits
  1 when the receipt cannot be cited now.
- `list` and `show` are words of `cw check`. To run a program named
  `list`, give its path: `cw check -- ./list`.
- `--tee` passes the command through as if CW were not there: its
  stdout goes to stdout and its stderr to stderr as it runs, and `cw check`
  exits with the command's own exit code (128 + the signal number when a
  signal ended it). The one receipt line goes to stderr; no JSON is
  printed.

### Test runs in Claude Code

With CW installed as a Claude Code plugin, a test run the agent starts
gets a receipt by itself. A `PreToolUse` hook on the Bash tool
(`scripts/auto-receipt-hook.mjs`) changes a plain test command into
`cw check --tee -- <the same command>`, so the agent sees the same output
and exit code, plus the receipt line.

- Changed: one simple command that starts with `npm test`, `npm run
  test…`, `pnpm`/`yarn`/`bun` `test` or `run test…`, `npx vitest`, `npx
  jest`, `pytest`, `go test`, `cargo test` or `make test`.
- Not changed: anything with a pipe, `&`, `;`, a redirect, `(`, a
  backtick, `$` or a backslash; any other command; and when `cw` is not on
  `PATH`.
- The hook decides no permission. Claude Code checks its permission rules
  against the changed command, so a rule for `npm test` alone no longer
  covers it; allow `cw check --tee -- npm test` too to skip the prompt.
- Off: set `CW_AUTO_RECEIPT=off` in the environment Claude Code runs in.

### The receipt file

A receipt is written once and never changed: `.cw/receipts/<id>.json`.
It holds `kind` (`check-receipt`), `schemaVersion` 1, `argv`, `cwd`,
`gitHead` (HEAD when the command started; null outside git), `dirty`,
`treeDigest` (sha256 over the uncommitted diff and the untracked files
that are not ignored, leaving out `.cw/`), `exitCode` (null when a signal
ended it), `signal`, `startedAt`, `endedAt`, `stdout` and `stderr` (each a
`sha256`, a `bytes` count and a `tail` of the last 20 lines, at most 2000
characters), `cwVersion`, `digest` (`sha256:` over the key-sorted JSON of
every field but `id`, `digest` and `signature`), and `id` (`rc-` and the
first 16 hex of the digest).

When `CW_CHECK_PRIVKEY` names an ed25519 private key (PEM text or a file),
the receipt also has `signature`, over the digest.
CW never hands that key to an agent.

What an unsigned receipt proves: the file was not changed after it was
written. It does not prove CW wrote it, since anyone can work out a
digest. It catches an agent that says "the tests pass" without running
them. It does not catch an agent that writes a whole false receipt into
`.cw/receipts/`. To shut that out, keep a key the agent cannot read: set
`CW_CHECK_PRIVKEY` when you run `cw check`, and `CW_CHECK_PUBKEY` for the
runs that cite receipts. An unsigned or wrongly signed receipt is then
refused (`receipt-unsigned`). Keeping the agent out of `.cw/receipts/` is
the job of the host's sandbox.

### Citing a receipt

A result cites a receipt as evidence: `receipt:<id>`. When the result is
taken in, and again at the commit, CW checks each cited receipt against
the code as it is now. It refuses unless all of these hold, in this order:

```text
receipt-not-found  no .cw/receipts/<id>.json        Next: cw check list
receipt-tampered   digest or id do not match        Next: cw check list
receipt-unsigned   CW_CHECK_PUBKEY is set and the
                   signature is missing or wrong    Next: cw check -- <command>
receipt-failed     exit code is not 0               Next: cw check -- <command>
receipt-no-git     made outside git with a commit   Next: git add -A && git commit -m "save work" && cw check -- <command>
receipt-stale      HEAD or the uncommitted files
                   differ from now, or CW could not
                   read the uncommitted changes     Next: cw check -- <command>
```

The message gives the reason and one next command, for example:
`Task verdict:x cites a receipt CW cannot accept: the code changed since
receipt rc-… was made (it ran at 1a2b3c4, now 5d6e7f8). Next: cw check --
npm test`. At the commit the code is `commit-verifier-receipt-refused`.

An accepted receipt is copied into the run
(`.cw/runs/<run-id>/receipts/<id>.json`). The report's evidence line then
reads `receipt:<id> — verified by receipt <id> (exit 0 at <sha>):
<command>`, and `cw report bundle` takes the receipt along.

## The gates

CW keeps committed state apart from work that is not done:

```text
only verified state becomes committed state
```

### Accept gates

A worker's `result.md` is data. CW refuses it, and tries the worker again,
when:

- `result.md` is a symlink, or resolves outside the worker's folder;
- a `cw:result` block in it is not valid JSON;
- a task that needs evidence cites none that is grounded (a `path:line`
  locator, a URL, or a `namespace:value` token, not free text);
- a P0, P1 or P2 finding has no grounded evidence of its own;
- a repository review cites mostly CW's own `.cw/` run files;
- a cited receipt fails a check in [Citing a receipt](#citing-a-receipt);
- the verdict cites a file that is not on disk, or a line past its end.

After 3 refusals the worker is parked and the run stops.

### The commit gate

A run makes one commit, at the end, once every worker is accepted. The
commit is gated on the verdict task (`verdict:*`, `synthesis:*`): its
accepted result must carry evidence, and that evidence must hold. A run
that cannot pass stops `blocked`, writes the report, and makes no commit.
`cw --resume --run <id>` tries again once the cause is fixed. There is no
unverified checkpoint: a run is committed by the gate or not at all.

The commit is one entry in the run's `commits` list, and a snapshot in
`.cw/runs/<run-id>/commits/state-0001.json`:

```json
{
  "id": "state-0001",
  "reason": "agent-delegation-drive: all 14 workers accepted",
  "verifierGated": true,
  "verifierTaskId": "verdict:synthesis",
  "evidence": ["src/server.ts:42"],
  "gitHead": "1a2b3c4..."
}
```

`evidence` is copied from the verdict task's accepted result. A refused
commit's reason starts `final commit refused:` and has one of these codes:

```text
commit-verifier-missing-evidence
commit-verifier-evidence-ungrounded
commit-verifier-evidence-unresolvable
commit-verifier-evidence-past-end
commit-rationale-empty-capture
commit-verifier-receipt-refused
```

`commit-verifier-evidence-unresolvable` and
`commit-verifier-evidence-past-end` follow
`CW_REQUIRE_RESOLVABLE_EVIDENCE` (on by default): a file locator must name
a file on disk, and a `path:line` or `path:a-b` locator a line inside it.
The reason reads `Verifier task <id> cites a line past the end of its
file: <path>:<line> (<path> has <n> lines)`. The same checks run when the
verdict's result is taken in, so a bad citation is retried and parked
there first. The commit gate is the last line.

## Verify a bundle

A bundle is one file, `<run-id>.cwrun.json`. It holds a run's report, its
results, its receipts and its telemetry ledger, with a digest for each
file. Anyone can check it offline with one command: no source repo, no
`.cw` folder, no key handed over on the side.

```text
cw report bundle <run-id> [--output FILE] [--with-trust-key PEM] [--extract-report FILE]
cw report verify-bundle <bundle> [--pubkey PEM] [--strict-signatures] [--require-signatures] [--extract-report FILE] [--json]
```

- `cw report bundle` writes the bundle (default: `<run-id>.cwrun.json` in
  the current folder), then verifies it at once. It exits 1 when the bundle
  would not verify, so a bad bundle is never handed on.
  `--with-trust-key` embeds an ed25519 PUBLIC key (default:
  `CW_AGENT_ATTEST_PUBKEY`). CW never exports a private key.
  `CW_MAX_RUN_ARCHIVE_BYTES`, `CW_MAX_RUN_ARCHIVE_FILES` and
  `CW_MAX_RUN_ARCHIVE_CONTENT_BYTES` cap its size.
- `cw report verify-bundle` exits 1 whenever `ok` is false, so
  `cw report verify-bundle <file> && ship` cannot pass on a forgery. It
  writes nothing but the `--extract-report` file, which must be under the
  current folder.

What `verify-bundle` checks:

1. **Archive bytes.** Every file's sha256, and the manifest digest, match.
2. **Telemetry ledger.** `telemetry.json` holds one record per agent hop,
   each hash-chained to the one before. The chain is worked out again; a
   broken link fails. A bundle with no `telemetry.json` passes this check.
3. **Signatures.** Each signed telemetry record is checked again with
   ed25519. Key order: `--pubkey`, then the bundle's embedded key, then
   `CW_AGENT_ATTEST_PUBKEY`. A `--pubkey` that differs from the embedded
   key fails (`trust-key-mismatch`).
4. **Report, result and signature agree.** For each record whose signature
   covers a result digest, the result file must hash to that digest, and
   `report.md` must hold the result under its own `### <taskId>` part.
   Editing the report, the result, or both into one matching lie fails.
5. **Receipts.** Each `receipts/<id>.json` must be intact and record
   exit 0. A failure shows as `receipt-tampered:<id>` or
   `receipt-failed:<id>` in `failedChecks`.

`trustLevel` is `"signed"` only when at least one result-covering
signature checked out, none failed, and check 4 held. Otherwise it is
`"unsigned"`. With no key, signatures are not checked and the intact chain
decides `ok`. `--strict-signatures` refuses that case.
`--require-signatures` refuses any `"unsigned"` bundle.

`--json` keys:

- `cw report bundle --json`: `schemaVersion`, `runId`, `archivePath`,
  `trustKeyEmbedded`, `verification`, `ok` (and `reportExtractedTo` when
  asked).
- `cw report verify-bundle --json` (and `verification` above):
  `schemaVersion`, `archivePath`, `runId`, `ok`, `archiveOk`,
  `telemetryVerified`, `trustKeySource`, `signatureKeyProvided`,
  `signaturesChecked`, `signaturesReverified`, `signaturesFailed`,
  `trustLevel`, `reportFindingsVerified`, `failedChecks` (and
  `reportExtractedTo`).

Read a green verdict as "the signed findings are present and unaltered",
nothing more. See [Trust model](#trust-model).

## Trust model

Read this before you trust a CW record. It says what the checks prove,
and what they do not.

CW keeps the books. It does not run the model. That is why the guarantees
hold, and it is also their limit.

### What is signed

The agent wrapper signs its usage report and the digest of the result it
wrote, with its own ed25519 private key, over
`{ usage, runId, taskId, promptDigest }`. The binding to this run, task
and prompt means a signature cannot be reused on another hop.

CW holds only the PUBLIC key (`CW_AGENT_ATTEST_PUBKEY`, or
`--agent-attest-public-key`). It verifies the signature when it takes the
result in, and again in `cw report verify-bundle`. It records one of three
states, and never moves one up to "trusted" quietly:

| State | Meaning |
|---|---|
| `attested` | A good signature over the usage, bound to this run, task and prompt, checked with the set public key. |
| `unattested` | Usage was reported, but the signature is missing, malformed, made with another key, or does not match. Also: no key is set. |
| `absent` | The agent reported no usage. |

The model id is what the agent said about itself (`agent-self-reported`)
or `absent`. CW never checks the claim.

### What is chained

`telemetry.json` holds one record per agent hop. Each record chains to the
one before through its hash; the chain starts from `sha256(runId)`.
Verification works out every hash again and never trusts a stored one. A
changed, reordered, removed or cut-short record breaks the chain. A ledger
that is there but cannot be parsed fails closed. This needs no key and no
network.

### What a green check proves

1. **Who said it.** Each `attested` number was signed by the holder of the
   private key, for that run, task and prompt.
2. **Not changed since.** The ledger has not been edited, reordered, cut
   short or had records taken out, as far as a chain the writer can work
   out again can show (see 3 below).
3. **Anyone can check it.** `cw report verify-bundle` works on your own
   machine, offline, with only the public key.
4. **CW made nothing up.** CW holds no private key and calls no model. It
   cannot sign, and it cannot invent a usage number.

### What it does not prove

1. **That the number is true.** A signature proves who said it, not that
   it was right. A dishonest keyholder can sign a lie; the lie is then
   bound to its signer. CW does not measure usage itself: that would mean
   calling the model.
2. **That a second party agrees.** When one operator runs CW, holds the
   only key and owns the machine, a green check shows that party agrees
   with itself. That is not third-party verification.
3. **That nothing was dropped.** The chain starts from a value the local
   writer knows. A writer who edits a record and then works out every
   later hash again makes a chain that verifies. So the guarantee is
   forward only: each signed finding that is in the report is unaltered.
   It does not say the report holds only signed findings, or that no
   signed finding was left out. CW-only decisions (the evidence gate, the
   commit gate) have no outside signer at all.
4. **That the work is good.** Signatures speak to where a record came from
   and whether it changed. The gates speak to evidence. Neither says the
   agent's answer is right.

To close gaps 2 and 3 you need a second party: a co-signer with a key the
operator does not hold, or an append-only place the local writer cannot
rewrite (a remote git history, a partner's log) where the run folder or
bundle is kept. CW cannot make that party itself.

### What an agent gets

CW starts the agent argv-style (`shell: false`), in the repository folder,
with stdin closed and a short, fixed env: `PATH`, `HOME`, `USER`,
provider-key names (`CW_`, `ANTHROPIC_`, `CLAUDE_`, `OPENAI_`, `GEMINI_`,
...) and the proxy and CA settings. These are never passed on, whatever
their prefix (`CW_NEVER_FORWARD_ENV` in
`src/shell/execution-backend/local.ts`):

- `CW_RELEASE_VERDICT_PRIVKEY`: the release verdict signing key;
- `CW_CHECK_PRIVKEY`: the receipt signing key;
- `CW_WORKBENCH_TOKEN`, `CW_BENCH_TRACE_FILE`.

Secret-looking arguments (the value after `--api-key`, `--token`, ...;
`sk-` and `ghp_` tokens; long opaque strings) are written as `<redacted>`
wherever CW records the command it ran.

CW is not an OS sandbox. The only limit CW enforces itself is that
`result.md` stays inside its worker folder and is not a symlink. Reads,
network and processes are the agent host's job.

## Output rules

Every command keeps to these. Scripts may rely on them.

1. **Streams.** stdout is data: the JSON result when piped or with
   `--json`. stderr is for people: progress, prompts, errors. A piped run
   that goes well writes nothing to stderr. Piped output has no escape
   bytes and no `\r`.
2. **Line forms.** An error is `cw: <what went wrong>`, then
   `Try: <command>`. Every stop names one next command. Going on with a run
   is always `cw --resume --run <id>`.
3. **Exit codes.** `0` done; `1` refused or failed; `2` a run that stopped
   with its report written. No other code.
4. **Stable shapes.** `--json` keys, exit codes and flags do not change
   shape. Human text and HTML may change. A later release may add a JSON
   field; do not depend on field order.
5. **Color.** Only on a TTY. Off with `NO_COLOR`, `CW_NO_COLOR`,
   `--no-color` or `TERM=dumb`; forced with `FORCE_COLOR`. Color is never
   the only sign: `✓` and `!` say the same.
6. **Lines, not redraws.** CW adds lines at the end; a sign of life is a
   new line, at least every 10 s while an agent works. (A wrapper's live
   view of its own agent may redraw in place on a TTY.)
7. **A broken pipe is not an error.** When the reader goes away early
   (`cw check list --json | head -1`), CW stops quietly with exit 0.
8. **Speed and size.** `cw version` and `cw help` answer in under 100 ms.
   The `cw help` front page has at most five entries before "More
   commands".

## Agents and wrappers

CW delegates. It starts the agent as a child process and reads back what
the agent wrote. The model runs in the agent's process, never inside CW.
CW has no model SDK, holds no API key, and calls no model API. Any key
comes from the agent's own env.

| Flag | Builtin | Runs |
|---|---|---|
| `-claude` | `builtin:claude` | `claude -p` (native) |
| `-codex` | `builtin:codex` | `codex exec` (native) |
| `-gemini` | `builtin:gemini` | Gemini via opencode (`CW_GEMINI_MODEL`) |
| `-opencode` | `builtin:opencode` | opencode (its default model) |
| `-deepseek` | `builtin:deepseek` | DeepSeek via opencode (`CW_DEEPSEEK_MODEL`) |
| `-muse` | `builtin:muse` | `muse exec` (`CW_MUSE_MODEL`) |
| `-copilot` | `builtin:copilot` | `copilot -p` (beta) |
| `-antigravity` | `builtin:antigravity` | `agy -p` (beta) |
| `-grok` | `builtin:grok` | `grok -p` (`CW_GROK_MODEL`) |

The agent is chosen in this order: a flag, then `CW_AGENT_COMMAND`, then
`$CW_HOME/agent-config.json`, then the first of claude, codex, gemini,
opencode, muse found on `PATH` (`CW_NO_AUTO_AGENT=1` turns that off).
Copilot, antigravity and grok are used only when asked for. A release
checks live only the vendors with a real-login receipt; a beta vendor has
a wrapper and an offline test only.

The wrappers live in `scripts/agents/` and are never imported by `src/`.
`builtin:claude` is `scripts/agents/claude-p-agent.js`: it feeds
`input.md` to headless claude, read-only, writes `result.md` itself, and
passes on the model and usage. A bare `claude -p {{input}}` does not
finish a worker: headless claude gets no prompt text and cannot write
`result.md`.

To add a vendor, add a wrapper script and one line in
`scripts/agents/builtin-templates.json`. No change to `src/`. Any command
plugs in the same way:

```bash
cw -q "..." --agent-command "node <path>/my-agent.js {{input}} {{result}}"
```

### The agent contract (cw-agent/1)

- **Start.** CW runs the command with no shell, as separate argv words, in
  the target repository. In each word it replaces `{{input}}` (the
  worker's `input.md`), `{{result}}` (the `result.md` path to write),
  `{{manifest}}`, `{{workerDir}}`, `{{model}}`, `{{prompt}}`, `{{phase}}`,
  `{{taskId}}`, `{{workerId}}` and `{{priorResults}}`.
  `{{priorResults}}` is the path of `<workerDir>/prior-results.json`:
  `{"schemaVersion": 1, "taskId", "phase", "priorResults": [...]}`, the
  accepted result of each task in an earlier phase. It is written only
  when the command names it. Stdin is closed.
- **Work.** Write the answer to `{{result}}` and exit 0. CW reads a fenced
  `cw:result` JSON block (`{"summary": ..., "findings": [...],
  "evidence": [...]}`), or else plain Markdown whose first line is the
  summary.
- **Report.** The agent may print one JSON line on stdout with `"model"`
  (and `"usage"`). Without it the run records `unreported`. CW never fills
  the model in from `--agent-model` and never checks the claim.
- **End.** Exit 0 with a `result.md` is done. Any other exit, no exit
  code, or no `result.md` is a failed try. Past the time limit the agent
  is killed and the worker parks at once.

### Calling CW from an agent

An agent that calls `cw` should: use only commands `cw help` lists; read
`--json` for anything it acts on; check the exit code, not a word in the
output; start processes argv-style; and never hand-edit a generated
vendor plugin file (run `npm run gen:manifests`).

## Removed surfaces

Batch 5 (2026-11-12, on the owner's word: large deletions and breaking
changes are open while CW is on 0.x) cut `src/` from 31,802 lines to under
10,000. Each removed verb now fails closed: `cw: Unknown command: <verb>`,
exit 1.

- **The MCP server**: `scripts/mcp-server.js`, `.mcp.json`, `server.json`,
  the vendor `mcp.json` files, `mcpName`, every `cw_*` MCP tool, and the
  CLI/MCP parity gate.
- **The step verbs**: `plan`, `dispatch`, `result`, `next`, `commit`,
  `quickstart`, `run` and its sub-verbs, `--link`.
- **Other verbs**: `audit-run`, `app`, `list`, `search`, `info`, `init`,
  `status`, `registry`, `queue`, `history`, `sandbox`, `backend`, `worker`,
  `feedback`, `audit`, `metrics`, `operator`, `telemetry`, `migration`,
  `state`, `contract`, `node`, `ledger`, `graph`, `man`, `completion`.
- **Off the receipt path** (2026-11-13, the owner's choice): `doctor`,
  `fix` and `demo tamper`. With no agent, `cw -q` stops `blocked` and its
  hint names the fix.
- **Earlier removals**: the multi-agent family (`multi-agent`,
  `topology`, `blackboard`, `coordinator`, `candidate`, `eval`, `summary`,
  `approve`, `reject`, `comment`, `handoff`, `review`), scheduling
  (`schedule`, `loop`, `routine`, `sched`), the workbench, reclamation
  (`gc`, `orphans`, `clones`), and `cw demo bundle`.
- **Machinery**: worker isolation and sandbox profiles; the container,
  remote and CI execution backends; the HTTP agent endpoint
  (`CW_AGENT_ENDPOINT`); unverified checkpoints, state nodes and node
  snapshots; ErrorFeedback records; observability, perf traces and cost
  accounting; the trust-audit chain (the telemetry ledger is the one chain
  that stays); every workflow app but `architecture-review`.
- **Old-state migration**: runs made before schema 2 are refused (see
  [Old runs are refused](#old-runs-are-refused)).
- **Flags**: `cw -q --check`, `--fast`, `--concurrency`, `--incremental`.
- **JSON fields**: `trustAuditVerified` in the bundle output.
- **The man pages**: the `docs/*.7.md` pages and `cw man` were merged into
  this one reference.

Files only the removed verbs wrote (`.cw/schedules/`, `.cw/routines/`, the
scheduling policy file under `CW_HOME`) are left on disk and no longer read. Delete
them by hand if you want the space.

## Release (operator runbook)

Every `npm run` command here runs in `plugins/cool-workflow/`. There is no
root `package.json`.

The build and release scripts start `npm`, `gh` and `git` the way `cw
check` does: with no shell. Native Windows is not supported; use WSL.

### Two ways out

- A **patch** (`X.Y.Z`, `Z > 0`) ships by itself on green `main`. No one
  runs a command. The operator only approves the `npm` environment run on
  GitHub. See [Automatic patch releases](#automatic-patch-releases).
- A **minor or major** (`X.Y.0`) is the operator's signed cut:
  `npm run release -- X.Y.0`. See [The operator's cut](#the-operators-cut).

Publishing is tag-driven. `release.yml` and `npm-publish.yml` fire on a
push of a `v*` tag; the auto-patch job dispatches `npm-publish.yml` on the
tag it makes. No tag, nothing new on npm. Release notes come from
`gh release create --generate-notes`; there is no changelog file.

### Hard rules

Do not work around them by hand.

- A minor or major needs a SIGNED verdict. The ed25519 private key stays
  with the operator (`CW_RELEASE_VERDICT_PRIVKEY`, normally
  `$HOME/.cw-keys/verdict-signing.key`). An agent never reads it, and it
  is never committed. The committed public key,
  `.cw-release/verdict-signing.pub`, makes CI reject an unsigned cut.
- The tag commit's first parent must be EXACTLY the reviewed sha (one
  hop). Never retag by hand. Never put a fix on the tag's line with a
  merge commit; cut again.
- Never `git tag` directly. Never bypass `release-flow.mjs`.
- Never write a verdict file yourself. The independent reviewer must run
  able to execute commands. A read-only or low-effort verdict is never
  trusted (`CW_RELEASE_REVIEW=1` raises the wrapper's effort and lets it
  write to the workspace).

### Automatic patch releases

The `auto-patch` job in `.github/workflows/release.yml`
(`scripts/release-auto-patch.mjs`) starts on `workflow_run` of the `CI`
workflow. It goes on only when that run was a push to `main` in this
repository and succeeded. It works on that run's commit
(`workflow_run.head_sha`), never on whatever `main` is now.

1. **Plan** (`release-auto-patch.mjs plan`). It skips (one log line, exit
   0) when: the repo variable `CW_AUTO_RELEASE` is `off`; the commit's
   subject starts with `chore(release)`; the commit is already in the
   newest release tag's history; or no shipped file changed since that
   tag's parent on `main`. "Shipped" is the `SHIPPED` list in the script:
   `src/`, `dist/`, `apps/`, `workflows/`, `skills/`, `agents/`,
   `commands/`, `hooks/`, `manifest/`, `ui/`, the runtime scripts
   (`scripts/cw.js`, `scripts/agents/`, `scripts/children/`, ...),
   `package.json` and the vendor plugin manifests; test folders in them do
   not count. A change to tests, docs, CI or release tooling alone does
   not release. It also skips when a commit since that tag needs more
   than a patch. CW follows Semantic Versioning, and the commit messages
   follow [Conventional Commits](https://www.conventionalcommits.org/)
   (a squash merge takes the PR title, so the PR title is the message):

   | Commit since the last tag | Level | Who releases |
   |---|---|---|
   | `fix:`, `perf:`, `docs:`, `chore:`, ... | patch | this job |
   | `feat:` | minor | the operator: `npm run release -- X.Y+1.0` |
   | `type!:` or a `BREAKING CHANGE:` footer | major (minor while on 0.x) | the operator |

   The skip line names the commit and the next cut. Patches start again
   after the operator's release. The next version is the highest `vX.Y.Z`
   tag plus one patch. The job FAILS when `package.json` on the commit is ahead of that:
   an operator minor or major is pending; cut it first.
2. **Bump** (`release-auto-patch.mjs bump`): `npm run bump:version --
   X.Y.Z` on that commit, `git add -u`, one commit by
   `github-actions[bot]`, and an annotated tag `vX.Y.Z`. The commit is
   detached: it is never pushed to `main`.
3. **Gate**: `release-gate.mjs` on the tag commit (build, full test suite,
   substance, test evidence, branch naming). A red gate leaves no tag.
4. **Verify**: `verify-release-verdict.mjs` on the tag commit, the same
   check `npm-publish.yml` runs.
5. **Push only the tag**, then `gh workflow run npm-publish.yml --ref
   vX.Y.Z` (a tag pushed with `GITHUB_TOKEN` starts no tag-push run; a
   dispatch does) and `gh release create vX.Y.Z --generate-notes
   --verify-tag`.

The publish waits in the protected `npm` environment for the operator's
approval, like every publish.

What the verifier accepts with NO verdict (its "automatic patch rule").
Anything else falls back to the signed-verdict check:

- (a) the tag commit's `package.json` version is `X.Y.Z` with `Z > 0`, a
  `vX.Y.Z` tag points at the commit, and the highest other tag below it is
  `X.Y.(Z-1)`;
- (b) the tag commit has one parent, that parent is an ancestor of
  `origin/main`, and the previous tag's parent is an ancestor of it (older
  `main` code cannot ship under a new number);
- (c) the tag commit's tree is byte for byte the bump made again from that
  parent (`verify-bump-reproduction.mjs --no-verdict`);
- (d) the `CI` workflow succeeded on a push to `main` at that parent:
  `GET /repos/{owner}/{repo}/actions/runs?head_sha=<parent>&event=push`,
  asked with `GITHUB_TOKEN` (`actions: read`). No token, an API error or
  an odd answer refuses.

A minor or major never passes this rule: it always needs the signed
verdict.

To stop automatic releases, set the repository variable
`CW_AUTO_RELEASE` to `off` (Settings, Secrets and variables, Actions,
Variables). Remove it, or set any other value, to start them again.

**`main` lags behind npm.** The bump commit lives only on the tag. After
an automatic patch, `main`'s `package.json`, `src/core/version.ts`, the
vendor manifests and `Formula/cool-workflow.rb` still name the last
version an operator cut landed on `main`. `version:sync` only checks that
`main`'s surfaces agree with each other. The next patch number always
comes from the tags. `npm run release:doctor` with no version uses
`main`'s version; give it the minor you mean to cut. A bump PR (subject
`chore(release): ...`) does not start a patch; any other merge before the
cut makes `auto-patch` fail with "an operator release is pending" until
the `vX.Y.0` tag exists.

### The operator's cut

1. **Agent prep.** Land the version bump as its own PR:
   `npm run bump:version -- X.Y.0 --content`. Before handing over, run
   the cut's own gate and review with a reviewer set (`CW_AGENT_COMMAND`,
   see the table below): `node scripts/release-flow.mjs --check --version
   X.Y.0`. It makes no commit, push or tag. Fix every finding first; a
   fault found in the real cut costs a full cut.
2. **Operator.** Run `npm run release:doctor -- X.Y.0` (seconds, no tests;
   it lists every problem at once with its fix). Then run
   `npm run release -- X.Y.0` in your own terminal
   (`scripts/release-oneclick.mjs`).

`release-oneclick.mjs` does, in order:

- **Stage 0, preflight** (`scripts/release-preflight.mjs`, the same checks
  as the doctor). It stops before anything is done when one fails.
- **Wait for CI**: the required checks on the cut commit, up to 45
  minutes. A red check stops the release here.
- **The cut** (`release-flow.mjs --cut --push`): the gate, the
  independent review, the signed verdict commit, and the tag.
- **Push only the tag** (`refs/tags/vX.Y.Z`). The verdict commit is a
  one-hop leaf on the reviewed commit, reached through the tag alone, so
  branch protection never blocks it.
- **GitHub Release**, then it waits for `release` and `npm-publish` and
  confirms `npm view`. The `npm-publish` run waits in the `npm`
  environment until you approve it on GitHub; the script prints its
  address.
- **Verdict-record PR** from a `release/vX.Y.Z-record` branch. Then it
  switches back to the branch it was run from and says `back on main.`

A re-run after any failure resumes: a tag that already exists goes
straight to the CI wait. When the tag is only local (its push failed), the
resume pushes it only after it checks that the tag commit carries
`.cw-release/review-<tag~1>.verdict` whose first line is
`APPROVED <tag~1>`, with a `.sig` that `verify-verdict-signature.mjs`
accepts against `origin/main`'s `.cw-release/verdict-signing.pub`.
Anything less is refused and nothing is pushed.

```bash
npm run release -- X.Y.0                    # the operator's cut
npm run release:doctor -- X.Y.0             # fast preflight first
node scripts/release-flow.mjs --check       # gate + review only, no change
node scripts/release-flow.mjs --check --local-tests
node scripts/release-flow.mjs --cut --version X.Y.0 [--push] [--no-release]
node scripts/release-flow.mjs --cut --version X.Y.0 --push --preflight-only
node scripts/release-flow.mjs --release --version X.Y.0 [--soft]   # make the GitHub Release for a pushed tag
```

### release:doctor

```text
npm run release:doctor [-- X.Y.Z] [--json] [--offline]
```

A fast preflight: a few seconds, no tests, no gate, no reviewer, no model,
and no change to anything. It lists ALL problems in one run, each with the
command that fixes it. The version defaults to `package.json`'s.

| Check | Fails when | Fix it gives |
|---|---|---|
| `head-current` | after `git fetch origin main`, HEAD is not the `origin/main` tip | `git checkout main && git pull --ff-only origin main` |
| `cut-branch` | a local `release/vX.Y.Z-cut` branch holds old code the tool did not make (a `warn` when the release run will remove it) | `git log origin/main..release/vX.Y.Z-cut`, keep what you need, then `git branch -D release/vX.Y.Z-cut`. The doctor never deletes it. |
| `clean-tree` | `git status --porcelain -uno` is not empty | commit or stash |
| `cw-dir` | (`warn`) a `.cw/` folder is at the repo root | `rm -rf <repo>/.cw` |
| `reviewer` | no reviewer is set (`CW_AGENT_COMMAND`, then `agent-config.json`, then auto-detect), or its first word is not an executable | `export CW_AGENT_COMMAND=...` |
| `signing-key` | `.cw-release/verdict-signing.pub` is committed and `CW_RELEASE_VERDICT_PRIVKEY` is not set, or is not a readable file (the key is never read or printed) | `export CW_RELEASE_VERDICT_PRIVKEY=$HOME/.cw-keys/verdict-signing.key` |
| `git-identity` | `user.email` is not set; a `warn` when it is not a `@users.noreply.github.com` address | `git config user.email "<id>+<login>@users.noreply.github.com"` |
| `gh` | (`warn`) `gh auth status` fails | `gh auth login` |
| `tag-local`, `tag-remote` | (`warn`) `vX.Y.Z` exists; the release run resumes it | — |
| `tools` | (info) node and npm versions | — |

Diagnostics go to stderr. `--json` prints
`{ ok, mode, version, failures, warnings, checks: [{ id, status, message, fix?, detail? }] }`.
Exit 0 when no check fails, 1 when one does. `--offline` skips the fetch,
the `ls-remote` and the `gh` check.

The cut works on a local branch, `release/vX.Y.Z-cut`. When a cut stops
before its tag is made, the tool switches back and removes that branch. A
fresh cut also removes one an earlier cut left. It removes the branch only
when it can prove the branch holds nothing but its own work: the exact
name, not checked out anywhere, no `vX.Y.Z` tag here or on origin, and no
commit on it but the one verdict commit. Anything it cannot prove keeps
the branch (`classifyCutBranch` in `release-preflight.mjs` decides). The
delete is `git update-ref -d` pinned to the checked sha. It never touches
a tag, a remote branch or `main`.

### The gate and the review

The gate (`scripts/release-gate.mjs`) has five steps: build, tests,
substance, test evidence, branch naming. In a cut, the tests step is
`--tests-from-ci`: it does not run the suite on the operator's machine. It
reads GitHub's check runs for the exact HEAD sha and passes only when every
required check is there, made by GitHub Actions for that sha, completed,
with conclusion `success`. The required checks are `check (22)` and
`check (24)`, named once in `REQUIRED_CHECKS` in
`scripts/release-ci-checks.mjs`. A missing, queued, failed, cancelled,
skipped or timed-out check; a `gh` that is missing, logged out or
failing; an `origin` not on github.com; a reply that is not JSON: each
fails the gate with its fix. Nothing falls back to a local run. On a pass
the gate writes `.cw-release/gate-ci-<sha>.json` (not tracked), and
`release-flow.mjs` puts the run URLs into the reviewer's input.

`--local-tests` (or `CW_RELEASE_LOCAL_TESTS=1`) runs the full `test:gate`
suite on this machine instead, for when CI cannot be reached.
`release-gate.mjs` run by hand with no flag runs the full suite too; the
tag-push gate in `release.yml` does that in CI. `CW_RELEASE_GATE_GH_CMD`
replaces the `gh` binary in tests.

The review is delegated to an agent through `CW_AGENT_COMMAND`; CW starts
it argv-style and pulls in no model SDK. The reviewer does not run the
gate again. It judges what the gate cannot (`agents/release-reviewer.md`).
Its last act is to write the verdict file,
`.cw-release/review-<sha>.verdict`, whose first line is exactly
`APPROVED <sha>`, or `REJECTED` with `kind: semantic-review` and numbered
findings at repo-relative `file:line` places. Markdown around a rejection
(`**REJECTED**`, `### REJECTED`, `1)` or `- ` lists) is taken off first.
Any other text is invalid output: the cut stops and no tag is made. A
reviewer that has rejected the same line of commits twice rejects a third
time with its earlier verdicts as evidence, and hands the decision to the
operator. When the reviewer exits non-zero, the flow stops with `reviewer
agent exited <code> — no verdict trusted.` and the last 20 lines it wrote.

After the review, before any bump, the cut checks the tracked tree again.
A change now came from the gate or the reviewer; the cut stops, names the
files, and signs nothing.

| Platform | Reviewer config |
|---|---|
| Claude | `CW_AGENT_COMMAND="claude -p --permission-mode acceptEdits {{input}}"` |
| Codex | `CW_AGENT_COMMAND="codex exec {{input}}"` |
| Gemini | `CW_AGENT_COMMAND="gemini -p {{input}}"` |
| OpenCode | `CW_AGENT_COMMAND="opencode run -m <provider/model> {{input}}"` |

`{{input}}` becomes the reviewer prompt's path. A headless reviewer needs
permission to write the verdict file (hence `acceptEdits` for claude) and
must be logged in.

### Changing a default

The reviewer holds POLA: an existing output, file layout, exit code or
flag does not change meaning or bytes. The one exception is a default the
operator chose to change. All three must hold in the release's diff
range: a merged PR's text has the operator's own words and a date for
that change; `docs/reference.md` says what the new default is, changed in
the same range; and the release raises the version (on 0.x a patch raise
is enough; from 1.0, the major). Missing one is a REJECT.

### Verdict signing setup

`grep -q '^APPROVED'` alone cannot tell a real verdict from a hand-written
one. Set up ed25519 signing once (`scripts/verdict-keygen.mjs` makes the
key pair):

```bash
node scripts/verdict-keygen.mjs --out-dir "$HOME/.cw-keys"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cp "$HOME/.cw-keys/verdict-signing.pub" "$REPO_ROOT/.cw-release/verdict-signing.pub"
git -C "$REPO_ROOT" add .cw-release/verdict-signing.pub
git -C "$REPO_ROOT" commit -m "chore: add release-verdict signing public key"
export CW_RELEASE_VERDICT_PRIVKEY="$HOME/.cw-keys/verdict-signing.key"   # keep it off the repo
```

`.cw-release/` is at the repo root, not under `plugins/cool-workflow/`.
Once `verdict-signing.pub` is committed, `release-flow.mjs` signs every
verdict it writes (a `.sig` file next to the `.verdict`), and
`release.yml`, `npm-publish.yml` and the local hook
`scripts/block-unapproved-tag.mjs` (it refuses an unsigned tag) all
require a valid signature on top of the `APPROVED` line.

### Where CI takes the verdict verifier from

`release.yml` and `npm-publish.yml` check a tag's verdict with
`scripts/verify-release-verdict.mjs` and its helpers
(`verify-verdict-signature.mjs`, `verify-bump-reproduction.mjs`,
`fake-date-for-reproduction.mjs`). CI never runs the tag's own copy: a tag
whose verifier is `process.exit(0)` would pass. A step named "Take the
release verifier from origin/main, not from the tag" copies each file with
`git show origin/main:plugins/cool-workflow/scripts/<file>` into
`$RUNNER_TEMP/cw-release-verifier/` and runs it there, against the tag
checkout. If `origin/main` cannot be fetched or lacks a file, the step
fails and nothing is published. The public key also comes from
`origin/main`. This holds while `main` stays protected.

### npm publishing trust

`npm-publish` uses npm Trusted Publishing: GitHub gives the job a short
OIDC token, npm checks the repo and workflow, and adds provenance. There
is no long-lived `NPM_TOKEN`. The workflow starts on the `v*` tag push, so
the provenance names the tag commit.

On a tag push the workflow file comes from the tag, so two settings
outside the repo hold the line:

- GitHub: Settings, Environments, `npm`. Deployment tags: only `v*`.
  Required reviewer: the operator.
- npm: the package's Trusted Publisher. Workflow `npm-publish.yml`,
  environment `npm`.

The job also refuses any ref that is not a `v*` tag, runs
`scripts/release-gate.mjs` again, checks the tag against the package
version, and checks the verdict with the verifier from `origin/main`.

### CI release rehearsal

The `release-rehearsal` job in `.github/workflows/ci.yml` runs the release
flow on every PR or push that changes release tooling, so a break shows in
CI and not in a real cut. It runs on Node 24, with its bundled npm and
with the newest npm:

```bash
npm run build
npm run version:sync
CW_AGENT_COMMAND="node plugins/cool-workflow/test/fixtures/release-rehearsal-reviewer.mjs {{input}}" \
  node scripts/release-flow.mjs --check --local-tests
```

The reviewer is a stub that prints `APPROVED <HEAD>`. The job has no
signing key and makes no tag, push or publish. It is not a required check.

### Before a cut, and while you change CW

```bash
npm run check               # tsc and the src/ size limit (10,000 lines)
npm run build
node test/<nearest>-smoke.mjs
npm run test:unit
npm test                    # a fast sample (npm run test:gate runs all smokes)
npm run gen:manifests -- --check
npm run release:check       # the full dry-run gate
```

`npm run release:check` does no harm: no tag, push or publish. It runs
docs presence, `dist:check`, `purity:check`, `lang:check`, `check`,
`test:ci`, `test:unit`, `gen:manifests -- --check`, `version:sync` and
`readme:check`. `--skip-tests` skips the two test steps.
`release-gate.mjs` does not run `readme:check`.

- `npm run fails-before:check [-- --base origin/main --json]`: when
  `src/` changed, the diff must add or change a test, and at least one
  changed test must fail against the base's committed `dist/` in a temp
  worktree. CI runs it on every PR (`fails-before` job, not required).
- `npm run readme:check`: the npm README (`plugins/cool-workflow/README.md`)
  is made from the root `README.md` by `scripts/sync-readme.mjs`. Edit the
  root one, then run `npm run sync:readme`.
- `npm run test:ci -- --json-summary "$TMPDIR/cw-test-summary.json"`
  writes a timing report; its `slowest` list helps pick a speed fix.

### Version surfaces

`npm run bump:version -- X.Y.Z` rewrites every structured version surface
from `package.json`: `package.json`, `src/core/version.ts`,
`manifest/plugin.manifest.json` (then `gen:manifests` carries it to the
vendor manifests), each `apps/*/app.json` (top-level `version` only), and
`Formula/cool-workflow.rb` (`tag:`). It replaces `old -> new` only, so
older references stay. It then rebuilds `dist/` and runs `version:sync`.

`npm run version:sync` (`scripts/version-sync-check.mjs`) checks those
surfaces agree, reading them from `git show HEAD:<path>`, not the working
tree. It also checks that this page ends with the release's footer line.
That line is `X.Y.0` for a minor or major, and the same `X.Y.0` line for a
patch, so a patch adds no line. `bump:version` fails when the line is
missing; `--content` appends it.

Two traps:

- A stale `dist/core/version.js` after a bump is the tsc cache:
  `rm -f .cache/tsconfig.tsbuildinfo && npm run build`.
- If gate mode ran first, `--content` says "already at X". Revert the
  structured files and run `--content` again from the old version.

### Wiki publish

After a release, the operator copies the wiki pages into a checkout
of the GitHub wiki:

```bash
git clone https://github.com/<owner>/<repo>.wiki.git <wiki checkout>
node plugins/cool-workflow/scripts/wiki-sync.mjs --to <wiki checkout>
```

`scripts/wiki-sync.mjs` copies every `project/docs/wiki/*.md` page, and
writes a short pointer page for each entry of
`project/docs/wiki/redirects.json`
(`{ "<Old-Page>": { "to": "<Page>", "why": "<one sentence>" } }`). It
prints one line per file it changed, never runs git, and leaves other
pages alone. With no `--to` it prints usage and exits 2. It writes nothing
and exits 1 when the folder is missing, `redirects.json` is not valid, a
redirect points at a page not in the copy, or a redirect has the name of a
page in the copy. The operator reviews `git status` in the checkout,
commits and pushes. A wiki page that is no longer true becomes a redirect,
not a deleted page.

### Merging PRs

Merge the oldest ready PR first; check the next one again after each
merge. Rebase on `main`, never merge `main` in. CI is the source of truth:
read the failed step, fix only that, push again.

## Version footer

`npm run version:sync` needs the current minor's line below, on its own
line. `npm run bump:version -- X.Y.0 --content` appends the next one.

0.4.0

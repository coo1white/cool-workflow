# VERIFIER-GATED-COMMIT(7)

## NAME

Verifier-Gated Commit - commit only state that got past an evidence-backed verifier

## SYNOPSIS

```text
cw -q "<question>"            # the drive ends in one verifier-gated commit
cw check -- npm test          # a done receipt a result can cite as receipt:<id>
```

## DESCRIPTION

Verifier-Gated Commit is the CW rule that keeps committed state apart from
work that is not done yet:

```text
only verified state becomes committed state
```

A run makes one commit, at the end of the drive, once every worker is
accepted. The commit is gated on the verdict task (`verdict:*`,
`synthesis:*`): its accepted result must carry evidence, and that evidence
must pass the checks in FAILURE MODES. The verifier gate has the final say.
A run that cannot pass it stops `blocked` with the reason, writes
`report.md`, and makes no commit; `cw --resume --run <id>` tries the commit
again once the cause is fixed.

There is no `cw commit` verb (removed in batch 5, with the step verbs) and
no unverified checkpoint: a run is either committed by the gate or not
committed.

## COMMIT RECORDS

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

The `evidence` field is copied from the verdict task's accepted result.

## DONE RECEIPTS

An agent that says "the tests pass" has only said it. A done receipt is
a record that the test command was truly run, on which code, and how it
ended. CW runs YOUR command; it never runs a model, and it never reads
the output for meaning. It only keeps the record.

```text
cw check -- <command> [args...]     run it, keep a receipt
cw check list                       every receipt, and if it may be cited now
cw check show <receipt-id>          one receipt, and the next step
```

`cw check -- npm test` runs `npm test` in the repo folder (`--repo
PATH`, default the current folder) with no shell: the words after `--`
are the program and its arguments, as they are. On a terminal its output
is shown on stderr as it runs (`--quiet` keeps it back); piped, it is
not shown, so a script sees only the data on stdout. On a terminal it
then prints one line:

```text
✓ passed: npm test (exit 0 at 1a2b3c4) — receipt rc-0123456789abcdef. Cite it as receipt:rc-0123456789abcdef. Next: cw check show rc-0123456789abcdef
✗ failed: npm test (exit 1 at 1a2b3c4) — receipt rc-0123456789abcdef records it. Fix the failure, then run: cw check -- npm test
```

Piped, or with `--json`, it prints one JSON object: `schemaVersion`,
`ok`, `id`, `cite`, `path`, `argv`, `exitCode`, `signal`, `gitHead`,
`dirty`, `signed`, `usable`, `code`, `reason`, `next`. A command that
does not end with exit 0 makes `cw check` exit 1 (the receipt of the
failure is still kept). A program that is not on PATH is an error and
leaves no receipt. `cw check list` and `cw check show` print JSON when
piped too; `show` exits 1 when the receipt may not be cited now.

Note: `list` and `show` are words of `cw check` itself. To run a
program named `list`, give its path: `cw check -- ./list`.

A receipt is a file, written once and never changed:
`.cw/receipts/<id>.json`. It has `kind` (`check-receipt`),
`schemaVersion` 1, `argv`, `cwd`, `gitHead` (HEAD when the command
started, or null outside git), `dirty`, `treeDigest` (sha256 over the
uncommitted diff and the untracked files that are not ignored, leaving
out `.cw/`), `exitCode` (null when a signal ended it), `signal`,
`startedAt`, `endedAt`, `stdout` and `stderr` (each a `sha256`, a
`bytes` count and a `tail` of the last 20 lines, at most 2000 chars),
`cwVersion`, `digest` (`sha256:` over the key-sorted JSON of every field
but `id`, `digest` and `signature`) and `id` (`rc-` and the first 16 hex
of the digest). When `CW_CHECK_PRIVKEY` names an ed25519 private key (PEM
text or a file), the receipt also has `signature` (ed25519 over the
digest text). CW never hands that key to an agent.

What an unsigned receipt does and does not prove. Anyone can work out a
digest, so an unsigned receipt shows only that the file was not changed
after it was written; it does not show that CW wrote it. It catches the
common case (an agent that says "the tests pass" without running them,
or after a run that failed), but not an agent that writes a whole false
receipt file into `.cw/receipts/`. To shut that out, keep a key where
the agent cannot read it: set `CW_CHECK_PRIVKEY` when you run `cw
check`, and `CW_CHECK_PUBKEY` for the runs that cite receipts, so an
unsigned or wrongly signed receipt is turned down (`receipt-unsigned`).
An agent that can write the repo can write `.cw/receipts/` too; keeping
it out is the host's sandbox's job.

A worker result, or a person, cites a receipt as evidence:
`receipt:<id>`. When a result is taken in by the drive and again at the
verifier-gated commit, CW checks every cited
receipt against the run's code at that time, and says no unless all of
these hold, in this order:

```text
receipt-not-found  no .cw/receipts/<id>.json        Next: cw check list
receipt-tampered   digest or id do not match        Next: cw check list
receipt-unsigned   CW_CHECK_PUBKEY is set and the
                   signature is missing or wrong    Next: cw check -- <command>
receipt-failed     exit code is not 0               Next: cw check -- <command>
receipt-no-git     made outside git with a commit   Next: git add -A && git commit -m "save work" && cw check -- <command>
receipt-stale      HEAD or the uncommitted files
                   are not the same as now, or CW
                   could not read the uncommitted
                   changes then or now              Next: cw check -- <command>
```

The message has the plain reason and the one next command, for one:
`Task verdict:x cites a receipt CW cannot accept: the code changed since
receipt rc-… was made (it ran at 1a2b3c4, now 5d6e7f8). Next: cw check --
npm test`. A refused result is retried and then parked, like any other
refused result; after the fix, `cw --resume --run <id>` goes on. At the
commit the error code is `commit-verifier-receipt-refused`.

An accepted receipt is copied into the run, `.cw/runs/<run-id>/receipts/
<id>.json`. So the run keeps it, `cw report bundle` takes it along, and `report.md` shows
it: the Answer's evidence line reads `receipt:<id> — verified by receipt
<id> (exit 0 at <sha>): <command>`, and a `## Check Receipts` part lists
each one (this part is not there for a run with no receipt). Making the
report again only reads these files: it never runs the command again
and never asks git. `cw report bundle` and `cw report verify-bundle`
check each pinned receipt again (its digest and id, and exit 0) and
fail with `receipt-tampered:<id>` or `receipt-failed:<id>` in
`failedChecks`; a bundle with no receipt gives the same output as before.

Where a new user finds it: `cw doctor` ends with the quick-start steps,
one of which is:

```text
cw check -- npm test   — keep a receipt that your tests passed; a result can cite it
```

`cw help check` gives its words.

## FILES

```text
.cw/receipts/<receipt-id>.json
.cw/runs/<run-id>/receipts/<receipt-id>.json
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/commits/<commit-id>.json
.cw/runs/<run-id>/report.md
```

## FAILURE MODES

The commit gate fails closed.

The codes, in the `final commit refused:` reason of the blocked commit step:

```text
commit-verifier-missing-evidence
commit-verifier-evidence-ungrounded
commit-verifier-evidence-unresolvable
commit-verifier-evidence-past-end
commit-rationale-empty-capture
commit-verifier-receipt-refused
```

`commit-verifier-evidence-unresolvable` and `commit-verifier-evidence-past-end`
follow `CW_REQUIRE_RESOLVABLE_EVIDENCE` (on by default): a file locator in
the verdict's evidence must name a file on disk, and a `path:line` or
`path:a-b` locator a line inside it. The reason reads `Verifier task <id>
cites a line past the end of its file: <path>:<line> (<path> has <n> lines)`.
The same checks run when the verdict's result is taken in, so a bad citation
is retried and parked there first; the commit gate is the last line.

The blocked commit step and `report.md` name the reason.

## COMPATIBILITY

Verifier-Gated Commit came in with CW v0.1.7. Batch 5 (2026-11-12) removed
the `cw commit` verb, unverified checkpoints, state nodes and ErrorFeedback
records; see release-and-migration(7).
0.1.51

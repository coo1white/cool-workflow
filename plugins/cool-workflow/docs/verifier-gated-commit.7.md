# VERIFIER-GATED-COMMIT(7)

## NAME

Verifier-Gated Commit - commit only state that got past an evidence-backed verifier

## SYNOPSIS

```text
node dist/cli.js commit <run-id> --verifier <node-id> --reason "verified result"
node dist/cli.js commit <run-id> --allow-unverified-checkpoint --reason "operator checkpoint"
cw check -- npm test          # a done receipt a result can cite as receipt:<id>
```

```ts
import { commitState } from "./commit";

commitState(run, {
  reason: "verified result",
  verifierNodeId: `${run.id}:verifier:task-one`,
  verifierGated: true
});
```

## DESCRIPTION

Verifier-Gated Commit is the CW rule that keeps committed state apart from
normal checkpoints:

```text
only verified state becomes committed state
```

A verifier-gated commit needs a `verifier` state node with `verified` status
and evidence, named with `--verifier <node-id>` (or found from a
`result:<task-id>` reason whose task has a verifier node).

The verifier gate has the final say.

The `--candidate` and `--selection` inputs went with the multi-agent family
(see release-and-migration(7), "Removed Surfaces"). A commit that passes
one of them now fails closed with `commit-verifier-required`.

## CHECKPOINTS

CW still writes inside snapshots for planning, dispatch, result recording, and
operator checkpoints. These records are checkpoints. They are good for audit,
resume, and rollback, but they are not verifier-gated committed state.

Checkpoint records have:

```json
{
  "verifierGated": false,
  "checkpoint": true
}
```

Checkpoint state nodes use `kind: "commit"` and `status: "completed"`. A
verifier-gated commit state node uses `status: "committed"`.

## COMMIT RECORDS

A verifier-gated commit writes gate metadata in the commit JSON and state node:

```json
{
  "verifierGated": true,
  "checkpoint": false,
  "verifierNodeId": "run:verifier:task",
  "evidence": []
}
```

The `evidence` field is copied from the verifier node. A commit record that an
older CW wrote may still carry `candidateId` and `selectionId`; they are kept
as data and read by `cw audit provenance`.

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
piped too; `show` exits 1 when the receipt may not be cited now. The
MCP tools `cw_check_list` and `cw_check_show` give the same JSON. Running
a command is CLI only: an MCP host runs commands with its own tool.

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
On the agent side, an agent sandbox (`CW_AGENT_SANDBOX=srt`) lets the
agent write only its worker folder and the sandbox profile's write
paths; with a profile that does not give write to the repo (`readonly`),
the agent cannot put a file in `.cw/receipts/`. A profile that writes the
repo does not keep it out.

A worker result, or a person, cites a receipt as evidence:
`receipt:<id>`. When a result is taken in (`cw worker output`, the
drive) and again at the verifier-gated commit, CW checks every cited
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
<id>.json`, and a `receipt.check` trust-audit event is written. So the
run keeps it, `cw report bundle` takes it along, and `report.md` shows
it: the Answer's evidence line reads `receipt:<id> — verified by receipt
<id> (exit 0 at <sha>): <command>`, and a `## Check Receipts` part lists
each one (this part is not there for a run with no receipt). Making the
report again only reads these files: it never runs the command again
and never asks git. `cw report bundle` and `cw report verify-bundle`
check each pinned receipt again (its digest and id, and exit 0) and
fail with `receipt-tampered:<id>` or `receipt-failed:<id>` in
`failedChecks`; a bundle with no receipt gives the same output as before.

Where a new user finds it (new in 0.4.0): `cw doctor --onramp` has one
more quick-start line, a change to existing default output made with the
operator's named yes of 2026-11-03 in
`project/docs/intent/2026-10-16-release-gate-ci.md`, "Operator decisions
for 0.4.0":

```text
cw check -- npm test   — keep a receipt that your tests passed; a result can cite it (no agent needed)
```

`cw help check` gives its words. The `cw help` front page is not
changed: it keeps the five entries of 0.3.3 (unix-principles(7)). Two more
outputs change, with the operator's named yes of 2026-11-03 in the same
file, "Operator decisions for 0.4.0, third review":

- `cw help`, the "More commands" list: its last line goes from
  `  man|version|fix|completion` to `  man|version|fix|completion|check`
  (every command `cw` knows is listed there; the v2 fixture
  `cli-help/_root.txt` pins it).
- `cw completion` (bash, zsh, fish): the list of command words has one
  more word, `check`.

## FILES

```text
.cw/receipts/<receipt-id>.json
.cw/runs/<run-id>/receipts/<receipt-id>.json
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/commits/<commit-id>.json
.cw/runs/<run-id>/nodes/<commit-node-id>.json
.cw/runs/<run-id>/feedback/<feedback-id>.json
.cw/runs/<run-id>/report.md
```

Every blocked commit try writes an `error` state node and an ErrorFeedback
record before the command exits.

## FAILURE MODES

The commit gate fails closed.

Common feedback codes:

```text
commit-verifier-required
commit-verifier-not-found
commit-verifier-wrong-kind
commit-verifier-not-verified
commit-verifier-missing-evidence
commit-verifier-evidence-ungrounded
commit-verifier-evidence-unresolvable
commit-verifier-evidence-past-end
commit-rationale-empty-capture
commit-verifier-receipt-refused
```

`commit-verifier-evidence-past-end` (from 2026-11-12, intent
`2026-11-11-user-facing-fixes.md` batch C): under the same rule as
`commit-verifier-evidence-unresolvable` (`CW_REQUIRE_RESOLVABLE_EVIDENCE`, on by
default), a `path:line` or `path:a-b` locator in the verifier node's evidence
names a line past the end of a file that is on disk, for one when the file got
shorter after the verdict was accepted. The reason reads `Verifier node <id>
cites a line past the end of its file: <path>:<line> (<path> has <n> lines)`.

Use `cw feedback list <run-id>` and `cw node graph <run-id>` to look at
the failed transition.

## COMPATIBILITY

Verifier-Gated Commit comes in with CW v0.1.7. It adds optional fields to
commit records and keeps older run state readable.

Programmatic snapshots that do not ask for a verifier gate stay checkpoints.
The CLI `commit` command is more strict: a plain by-hand commit fails closed unless
the operator passes `--allow-unverified-checkpoint`.
0.1.51

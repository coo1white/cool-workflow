# User Guide: your first ten minutes

This page comes from a real test. On 2026-09-02 an AI that had never seen
Cool Workflow installed it, read only the README and `cw help`, and tried
to get a report on a small sample project. It hit four things that would
make a new user give up. All four were fixed the same day, and the same
test was run again on the fixed build. This page tells you what to type,
what you will see, and what to do when something stops.

## What you get

CW puts your AI coding agent to work on one question about a project and
saves the answer as a report where every claim points to a file and a
line. The report is a file on your disk, not a chat you lose. In the test,
the first report came back in under three minutes, said the sample "has no
server and no API", and found two real bugs the tester had not seen.

## The five commands that worked first time

```bash
cw                 # the short menu
cw help            # every command and flag
cw doctor          # checks node, git, your agent, and file write access
cw demo tamper     # builds a signed record, breaks it three ways, catches all three
cw app list        # the ten built-in apps and what each one needs
```

If you type a command wrong, CW tells you the near one:
`Unknown command: doctr. Did you mean: doctor?`. If you forget the
question, it prints the line to type.

## Ask your first question

Go into your project and type:

```bash
cw -q "How does the done command mark an item finished and where can it go wrong?" -claude
```

`-claude` says which agent does the work (`-codex`, `-gemini`, `-deepseek`
and `-muse` work too). When it ends, CW opens the report in your browser by
itself and prints the path plus one line for later:

```text
✓ Report: /path/to/project/.cw/runs/<run-id>/report.md
  ✓ Status: complete — 14/14
  ✓ Report opened. Again later: cw report --open
  Try: cw report --show
```

A full run on a small project takes some minutes. The test's second run
used 14 workers in four stages and took about eleven minutes.

## If you are not inside a project

CW now stops at once:

```text
cw: <path> is not a git project. Run cw inside a project, or pass --repo <path>.
```

Before the fix it said nothing and reviewed everything under the folder,
including its own files, for three minutes. Now it refuses in well under a
second and writes nothing.

## If the run stops before the end

A run can stop when one worker gives back a bad result. Two things are
true now that were not before:

- A worker whose result block is not closed gets a second and a third
  try by itself, with the reason in its next input. One bad worker no
  longer parks the whole run.
- The resume command works as the help prints it. From inside the
  project:

```bash
cw --resume --run <run-id>
```

From outside the project, add `--repo <path>`. The longer forms
`cw quickstart <app> --resume --run <run-id>` and
`cw run resume <run-id> --drive --repo <path>` do the same thing.

## What is in the run folder

`.cw/runs/<run-id>/` holds only what the run made. On a normal run you
see:

```text
state.json      where the run is now
report.md       the report
tasks/          one file per task
results/        each worker's result with its evidence
workers/        each worker's input, output and record
dispatches/     who was sent what, when
nodes/          checkpoints of the run's state
audit/          the trust-audit chain
commits/        state that passed the checks
telemetry.json  the signed usage ledger
```

Other directories (`blackboard/`, `candidates/`, `topologies/`,
`feedback/`, a worker's `artifacts/` and `logs/`) exist only if a file
was written into them. Before the fix a single run left 33 empty
directories behind; the second test run left none.

## Check your setup, in your words

`cw doctor --onramp` prints three steps for a person using CW on their
own project. It talks about release gates and surface guards only when
you run it inside the Cool Workflow repo itself.

## What the test could not show

Be honest about limits. In the second test run no worker failed, so the
"second try" path was proved by the test in the pull request, not by the
walkthrough. And `cw --resume --run <run-id>` typed from outside the
project without `--repo` says `Run not found`; the short help line does
not yet say this.

## Where to go next

- [Getting Started](Getting-Started.md) for install and the 30-second proof.
- [Recovery And Restore](Recovery-And-Restore.md) for resume, export and import.
- [Trust And Audit](Trust-And-Audit.md) for what the checks prove.
- The two receipts of the test runs are in the repo under
  `plugins/cool-workflow/project/docs/audits/` (`four-fixes-receipt-2026-09-02.json`
  and `run-folder-receipt-2026-09-02.json`), each bound to the commit it tested.

# Unix-Inspired Workflow Principles

CW takes a small group of long-lasting systems ideas and puts them to work in agent
workflow engineering. These are design principles, not platform claims — but
they are not a free choice: this project keeps closely to the FreeBSD programming
way of thought, and §7 below gives the binding rules every change is checked
against (copied as hard limits in the repository's `AGENTS.md`).

## 1. Everything Is State

Every workflow event with meaning should be kept as state you can look into.

CW keeps now:

- the run in `.cw/runs/<run-id>/state.json`
- each worker's `input.md`, `manifest.json` and `result.md` in
  `.cw/runs/<run-id>/workers/<worker-id>/`
- accepted results in `.cw/runs/<run-id>/results/`
- the signed telemetry ledger in `.cw/runs/<run-id>/telemetry.json`
- the verifier-gated commit snapshot in `.cw/runs/<run-id>/commits/`
- the report in `.cw/runs/<run-id>/report.md`
- `cw check` receipts in `.cw/receipts/`

The working rule is:

```text
prompt, task, result, error, verifier decision, commit
= state that can be inspected, resumed, bundled, or compared
```

This keeps the runtime fixed and certain, and keeps agent work open to check.

## 2. Small Kernel, Composable Userland

CW should keep the kernel small. The kernel is the owner of state changes and
fixed contracts; the workflow app is the owner of its field behavior.

The kernel's calls:

```text
plan()
delegate()
accept()      # the evidence gate
commit()      # the verifier-gated commit
report()
```

The kernel should keep away from hard-coded business logic. Field behavior
lives in the workflow app (`apps/architecture-review/`): its phases, prompts
and evidence rules. Vendor behavior lives in the agent wrappers under
`scripts/agents/`, never in `src/`. `src/` stays under 10,000 lines
(`scripts/size-check.mjs`).

## 3. Pipelines Over Monoliths

CW is for clear data flow in place of hidden control from above.

The pipeline is:

```text
question
-> plan (the app's phases and tasks)
-> worker input.md
-> agent
-> result.md
-> evidence gate (accept, retry, or park)
-> verifier-gated commit
-> report
```

Each stage has a file you can read. If a stage has a fault, its reason goes
into the next try's `input.md`, or into the report, in place of going away
into a black box. `--json` keeps output a script can use.

## 4. Isolated Workers

Workers are kept apart by scope, state, and output: one folder, one
`input.md`, one `result.md` each. A worker fault does not damage the
workflow kernel: a worker that has failed is a state change (retried, then
parked), not a fault across the whole process. CW checks that `result.md`
stays in its worker folder; the agent host is still the one responsible for
OS-level file access, command running, network access, and environment
filtering.

## 5. Verifier-Gated Commits

CW does not put every made answer into the committed state. Made work goes
through the evidence gate on accept, and the verdict's evidence through the
commit gate. The rule:

```text
only verified state becomes committed state
```

A run that cannot pass the gate stops `blocked` with the reason; its report
is still written, and it says the run did not commit.

## 6. Practical Operating Rule

```text
The kernel provides deterministic pipes.
Workers work in isolation.
Verifiers decide what may be committed.
Hosts enforce runtime sandbox policy.
```

This keeps CW small, open to looking into, and able to be grown.

## 7. FreeBSD Discipline (Binding Rules)

The principles above come down from one tradition — the FreeBSD school of
systems engineering — and CW keeps to it strictly. In clear terms:

**POLA — Principle of Least Astonishment.** An output, file layout,
exit code, or flag that is here now never changes meaning or bytes under an operator. New
behavior comes out behind a new verb/flag or an env toggle, with the earlier
behavior byte-identical by default. (Example: live drive output is added on top —
stderr only, TTY-gated, `CW_NO_STREAM=1` opt-out; the stdout payload and
evidence digest are not changed.) One exception: a default the operator
chooses to change. Three things must all be true. A merged PR's text keeps the
operator's own yes, in their words, with a date. The matching `docs/*.7.md`
says what the new default is, in the same release. The release puts up the
version (on 0.x a patch step is enough, 0.3.0 to 0.3.1; from 1.0, the major
version). If one of the three is
not there, it is a POLA break, and the release reviewer says no.

**Mechanism, not policy.** The kernel gives mechanisms; policy is data in
userland. WHICH agent runs is config (`CW_AGENT_COMMAND` / agent-config), not
code; vendor-specific rendering is in wrappers under `scripts/agents/`,
never in core. Core may send a vendor's stream on; it never reads one apart.

**Rule of Silence.** stdout is data, stderr is diagnostics, and a
non-interactive run says nothing on success. Anything friendly to a person is TTY-gated
and can be turned off; `--json` output is fixed and with nothing added so it goes together
in pipes. A broken pipe is not an error: when the reader at the other end
goes away early (`cw check list --json | head -1`), the CLI stops quietly with
exit 0 — no stack trace, no error text (both `--json` and human output).

**Fail closed, conservative defaults.** Backends not yet configured probe as
`unverified`, telemetry that cannot be verified is made known loudly (or turned away in strict
mode), results that are not valid park the hop. CW never makes up a success and never
falls back with no word. Dull right answers beat clever features.

**Tools, not frameworks.** Zero runtime dependencies is a red line. Verbs do
one thing; things come together through long-lasting files (`.cw/`) and pipes, not
hidden joining inside the process.

**Man pages are the contract.** Every capability that ships has a `docs/*.7.md`
page kept up to date in the same change, and doc-drift guards in the test suite keep
the documented commands true. Behavior with no docs is behavior not finished.

**style(9) spirit.** One same style for each layer; a diff is in keeping with the file
it touches and never reformats code it does not change.

**Release engineering.** Main is -CURRENT; a tag is -RELEASE: it is there only
after the deterministic gate and an independent review pass, and cadence never
goes over the gate.

A change that goes against any rule in this section is turned down in review even if
the capability it ships is in other ways wanted.

## 8. The First Five Minutes and the CLI Scale

Section 7 says how the code is made. This section says what a person has in
front of them. D1 is the one moment CW is for; D2 is the small scale every
command keeps to. The numbers are measured, not hoped for: the 2026-09-28
measure ran `cw -q` through each state below with stub agents, on a TTY and
piped. A row marked **gap** is a known failure, fixed one change at a time.

### D1. The soul moment

A person in a git project types:

```text
cw -q "<question>" -claude
```

and in five minutes or less, with no setup file and no choices to make, has
an answer with `file:line` evidence (the `## Answer` part of
`.cw/runs/<id>/report.md`) and one line naming what to do next.

| Step | What the person sees | Bar | Measured |
|---|---|---|---|
| Start | the process is up (`cw --version`, `cw help`) | 0.1 s | 55 ms |
| Plan | first `[drive] ==> <Phase> (<done>/<total>)` line on stderr (TTY only) | 1 s | 0.2 s |
| Each wait | a new line at least every 10 s while a worker runs | 10 s | yes: `[drive]   … <Phase> still working — 10s`; since 0.3.3 a shipped wrapper's live view, redrawn in place, takes its place in a serial hop |
| End | `✓ Report: <path>`, `✓ Status: complete — N/N workers`, `Next:` | 5 min | 233 s and 259 s (real agents, default review) |
| Read | `## Answer` with evidence, one file read away | — | yes |

Every state has one screen. Each ends with one next command.

| # | State | What it must show | Measured |
|---|---|---|---|
| 1 | First use: bare `cw`, `cw help` | the short front page, exit 0 | yes |
| 2 | No agent set | `blocked`, `Try: cw doctor`; JSON names `CW_AGENT_COMMAND` | yes; the phase line counts the phase (`Map (0/6)`), the end line the run (`0/14 workers`) |
| 3 | Empty: `cw report` with no run | `No run yet. Try: cw -q "<question>"` | yes |
| 4 | Loading | a line when each worker starts and ends, and a line at least every 10 s between | yes: since 0.3.2 a concurrent round, too, prints each worker’s `spawning agent` line when the round starts, not after it ends (an operator decision for 0.3.2); since 0.4.3 the “may take minutes…” note is said once in a run, not on every line |
| 5 | Success | report path, status, one `Next:` line | yes |
| 6 | A worker fails | why (the agent's own words), and `Next: cw --resume --run <id>` | yes: `Why:` gives the reason and the agent’s last stderr line; the last line is `Next: cw --resume --run <id>` |
| 7 | Offline | as 6, with the network error named | as 6 |
| 8 | Slow | as 4 | as 4 |
| 9 | Missing input: no question on a TTY | `Question: ` prompt on stderr; Ctrl-D stops it | yes |
| 10 | Missing input: `--repo` names no folder | `cw: <path> does not exist`, exit 1, nothing made | yes |
| 11 | Too long: a 76 KB report | the terminal stays short; the length goes to the file | yes |
| 12 | Color: `NO_COLOR`, piped, `TERM=dumb` | no escape bytes | yes |
| 13 | Narrow (40 columns), screen reader | lines only, added at the end, no redraw | yes |
| 14 | Ctrl-C | stops after the worker in hand, keeps done work, names the resume command | yes |

### D2. The CLI scale

One page. A new verb, flag, or line of output keeps to all of it.

1. **Streams.** stdout is data: the JSON result when piped or with `--json`.
   stderr is for the person: `[drive]` lines (TTY only), prompts, errors. A
   piped run that goes well writes nothing to stderr; piped output has no
   escape bytes and no `\r`.
2. **Line forms.** Progress: `[drive] ==> <Phase> (<done>/<total>)`. End:
   `✓ Report: <path>`, then `✓ Status: <state> — <done>/<total> workers` (`!` in place
   of `✓` when the run is not complete), then `Next: <command>`. An error:
   `cw: <what went wrong>`, then `Try: <command>`. Every stop names one next
   command, and a thing has one spelling: to go on with a run it is
   `cw --resume --run <id>`.
3. **Exit codes.** `0`: CW did its work and the state is saved, which takes in
   a run that is `blocked` or `parked` (the JSON `status` says which). `1`: CW
   said no or could not start (bad input, no such run, not a git project).
   No other code comes from the top level.
4. **Color.** Only on a TTY. Off with `NO_COLOR`, `CW_NO_COLOR`,
   `--no-color`, or `TERM=dumb`; on by force with `FORCE_COLOR`. Color is never the only sign:
   `✓` and `!` say the same thing without it.
5. **Lines, not redraws.** Output is added at the end, line by line: no
   spinner, no cursor moves. A sign of life is a new line.
6. **Speed.** `cw --version` and `cw help` come back in under 100 ms.
7. **The front page.** `cw help` gives at most five entries before
   "More commands". A new one goes on only when an old one comes off.
8. **The Homebrew test.** Before a new flag or verb, the change says:
   would `brew` do this? Can a verb, flag, or env var that is here now do it
   (if yes, no new flag)? Is the default output the same to the byte? What
   does `cw help` look like after?

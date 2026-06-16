# Unix-Inspired Workflow Principles

CW takes a small group of long-lasting systems ideas and puts them to work in agent
workflow engineering. These are design principles, not platform claims — but
they are not a free choice: this project keeps closely to the FreeBSD programming
way of thought, and §7 below gives the binding rules every change is checked
against (copied as hard limits in the repository's `AGENTS.md`).

## 1. Everything Is State

Every workflow event with meaning should be kept as state you can look into.

CW keeps now:

- workflow runs in `.cw/runs/<run-id>/state.json`
- task prompts in `.cw/runs/<run-id>/tasks/`
- dispatch manifests in `.cw/runs/<run-id>/dispatches/`
- result envelopes in `.cw/runs/<run-id>/results/`
- state snapshots in `.cw/runs/<run-id>/commits/`
- schedules in `.cw/schedules/tasks.json`
- routine trigger events in `.cw/routines/`
- candidate scoring records in `.cw/runs/<run-id>/candidates/`
- commit gate failures in `.cw/runs/<run-id>/feedback/`
- sandbox profile selections in worker, dispatch, feedback, and report state
- workflow app identity and version in `.cw/runs/<run-id>/state.json`
- canonical app matrix run state in temporary `.cw/runs/<run-id>/` workspaces
- golden path proof artifacts in temporary `.cw/runs/<run-id>/` workspaces
- operator summaries made from state without changing run files
- MCP app-surface smoke runs driven through stdio JSON-RPC

The working rule is:

```text
prompt, task, dispatch, result, error, verifier decision, schedule, trigger
= state that can be inspected, replayed, snapshotted, or compared
```

This keeps the runtime fixed and certain, and keeps agent work open to check.

## 2. Small Kernel, Composable Userland

CW should keep the kernel small. The kernel is the owner of state changes and
fixed contracts; workflow apps are the owners of their field behavior.

Core system calls:

```text
plan()
dispatch()
recordResult()
verify()
commit()
report()
sandbox()
schedule()
trigger()
```

The kernel should keep away from hard-coded business logic. New behavior should
for the most part come in as:

- a workflow app
- a workflow app manifest under `apps/<app-id>/app.json`
- a verifier
- a scheduler policy
- a routine trigger
- an external worker

Workflow App framework v0.1.9 makes this split solid and clear. The runner is the
base system. Apps are userland: versioned, checked definitions you can look into,
that can be listed, shown, validated, initialized, packaged, planned, and reported
without leaning on hidden runner internals.

The v0.1.12 Operator UX layer is userland over state. It puts out `status`,
`graph`, `report --show`, and resource summaries without being the owner of core
changes.

The v0.1.13 MCP app surface is the same way of work put to agent hosts: a
small JSON tool bridge over the base runtime, old names kept, read-only
looking-in kept apart from change, and every change put away into the run.

The v0.1.13 canonical apps are kept-up userland:

```text
architecture-review
pr-review-fix-ci
release-cut
research-synthesis
```

They keep field prompts, inputs, evidence gates, and sandbox hints in app
directories in place of runner internals.

The v0.1.10 `end-to-end-golden-path` app is by design dull userland. It
has one readonly worker task and is here to give proof that the base system pipes are
joined up.

## 3. Pipelines Over Monoliths

CW is for clear data flow in place of hidden control from above.

The normal pipeline is:

```text
workflow definition
-> app contract validation
-> validated input
-> task files
-> dispatch manifest
-> worker result
-> result envelope
-> verifier gate
-> verifier-gated commit or explicit checkpoint
-> report
```

Each stage should have an artifact you can read. If a stage has a fault, its error
output should become input for the next fix step in place of going away into a
black box.

Operator views keep to the same rule: console summaries point to plain files,
while `--json` and `--format json` keep output a script can use.

The release golden path is the regression form of this rule:

```text
npm run golden-path
```

It puts the public CLI to work and then looks into state files for app metadata,
dispatch, worker manifest, result node, verifier node, candidate score, ranking,
selection, verifier-gated commit, report, and no ErrorFeedback.

The canonical app matrix is the userland regression form:

```text
npm run canonical-apps
```

It checks and plans every kept-up app without running full workers for
each app.

## 4. Isolated Workers

Workers should be kept apart by scope, state, and output.

Helpful layers for keeping apart:

- separate task prompts
- separate result files
- separate run directories
- separate workspace or sandbox directories for risky work
- separate score/evidence records for competing candidates
- named sandbox profiles for read/write/execute/network/env policy

A worker fault should not damage the workflow kernel. A worker that has failed is a
state change, not a fault across the whole process.

Sandbox Profiles keep policy clear. CW keeps the profile id and worked-out
policy in long-lasting state, checks paths, and takes or turns away worker output
against the write policy. The agent host is still the one responsible for OS-level file
access, command running, network access, and environment filtering.

## 5. Verifier-Gated Commits

CW should not put every made answer back into the main workflow state.
Made work should go through evidence and verifier gates first.

The rule for merging we are for is:

```text
only verified state becomes committed state
```

For branches against one another, the shape is:

```text
candidate workers -> score records -> verifier-gated selection
-> verifier-gated commit()
```

Snapshots with no gate are checkpoints. They are let through as records for check and
for taking up again, but reports and commit records must not put them forward as
verifier-gated committed state.

## 6. Practical Operating Rule

```text
The kernel provides deterministic pipes.
Workers explore in isolation.
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
evidence digest are not changed.)

**Mechanism, not policy.** The kernel gives mechanisms; policy is data in
userland. WHICH agent runs is config (`CW_AGENT_COMMAND` / agent-config), not
code; vendor-specific rendering is in wrappers under `scripts/agents/`,
never in core. Core may send a vendor's stream on; it never reads one apart.

**Rule of Silence.** stdout is data, stderr is diagnostics, and a
non-interactive run says nothing on success. Anything friendly to a person is TTY-gated
and can be turned off; `--json` output is fixed and with nothing added so it goes together
in pipes.

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

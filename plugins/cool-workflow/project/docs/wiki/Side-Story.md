# Side Story: One Frame, Five Lenses

*A side note from the CW dev diary — 2026-07-12. How CW gets audited
by the same sort of agents that build it, and what one audit run
turned up. This is a record of that day: file names and numbers are
as they were then (the release scripts, for one, have since become
`.mjs` files).*

---

## The story behind this

CW is made in an unusual way. Agents write the code, agents review
the PRs, and from time to time agents are turned on the codebase
itself to take it apart. The project has done this more than once:

- Two architecture-review campaigns, which ended as merged fix PRs.
- A security audit of the release trust chain (2026-07), which found
  five real ways around the signing backstop — all closed by PRs
  #443–#449.

Every campaign taught the same lesson: **one agent reading the whole
codebase gives thin, general notes. Five agents, each with one narrow
question, give deep, specific findings.** But only if the five run
under one shared set of rules — or you get five different report
formats, five ideas of "severity", and a pile of noise.

So the audit method became a fixed thing: **one frame, five lenses.**
This page is the story of that method, and of the robustness audit we
ran with it today.

## The design idea

The design copies how the Claude team builds agent systems: do not
make one clever agent — make simple parts working side by side, each
with one clear job, hard rules on evidence, and a second pass that
checks the first.

**The frame** is the part every agent gets word for word:

1. **The project's own rules are the judge.** Every agent first reads
   `AGENTS.md` — fail closed, POLA, stdout is data, resumable runs,
   zero runtime dependencies. A finding is not "this is not best
   practice"; it is "this breaks a promise the project itself made."
   That one move kills most arguments about taste.
2. **Forced evidence.** Every finding must give `file:line`, one line
   on the defect, one concrete failure story (this input/state → this
   wrong outcome), and a severity: P1 (data loss, silent wrong
   result, fail-open in a trust path), P2 (a crash or broken flow you
   can see and get out of), P3 (small). No failure story, no finding.
3. **Noise control.** No style points. No guesses the agent did not
   trace in the code. Check the docs first — some strange-looking
   behavior is by design and documented. 3–8 strong findings beat 20
   weak ones.
4. **A second pass.** The lead agent re-checks every finding against
   the source before taking it. Past campaigns proved this is not
   optional: some findings, however well argued, are non-issues.

**The lenses** are the only part that changes. Each lens is one
narrow question, aimed at one promise CW makes:

| # | Lens | The question | The promise it tests |
| --- | --- | --- | --- |
| 1 | State and resume | What happens when a write stops half-way? | Durable, inspectable state |
| 2 | Fail closed | Does a missing input block, or quietly pass? | Fail closed, never invent success |
| 3 | Input boundaries | What does bad input do at the CLI/MCP edge? | Documented surfaces |
| 4 | Concurrency | Who cleans up a child that will not die? | Boring recovery |
| 5 | Gates and release | Does a re-run resume, or double-run, or hang? | Gated, resumable releases |

Five lenses, run side by side, on the same tree, at the same commit.
None of them sees the others' work. When two lenses find the same
defect from two directions, that is not waste — that is the strongest
signal the run produces.

## What one run of the frame found

Today's run (at commit `88bcbe9`, after the release-trust fixes were
all in) came back with about two dozen verified findings. The five
biggest, each re-checked against the source line by line:

**1. The resume that cannot resume (P1, release tooling).**
The release contract says a re-run after any failure RESUMES. But
`release-flow.js` makes the local tag first, then pushes it. If the
network drops between the two, the tag exists only locally. On
re-run, `release-oneclick.js`'s `alreadyCut()` sees the local tag,
takes the cut as done, and jumps to the CI wait — for a CI run on a
tag that was never pushed. It waits 45 minutes and dies. No code path
re-pushes the tag. The resume promise breaks at the one failure point
where a resume is needed most.

**2. The kill that gets eaten (P1, concurrency).**
The batch delegate child installs a SIGTERM handler whose first
firing does not exit — by design, it forwards the signal to its own
children and waits for their `close` events. But the parent uses
`spawnSync`, which on timeout sends exactly one SIGTERM and can never
send a second. If any grandchild keeps a stdout pipe open, `close`
never fires, the child never exits, the parent's one kill is
absorbed, and the whole drive blocks until an operator does `kill
-9`. The codebase even has a comment naming this exact hazard — the
batch path rebuilt it anyway.

**3. The lock that guards the wrong span (P1 ×2, state).**
Two separate findings, one root. The telemetry attestation ledger
does load → append → write-whole-file with no file lock; two
processes appending at the same time = one record quietly gone, and
because the surviving chain still links, verification stays green — a
tamper-evidence record is lost with no sign. And the drive loop
writes back a run object it loaded minutes earlier; the lock covers
only the write instant, so anything another process landed in between
(feedback, audit decisions, another drive's bookkeeping) is
overwritten. Two independent lenses found the second one — state and
concurrency, from opposite directions.

**4. The gate wired to `() => true` (P2, fail closed).**
The pipeline contract declares `requireReadablePaths: true`: a stage
must refuse when a required artifact file is missing. The check takes
a `pathExists` function — and in the live pipeline, no caller passes
one, so it defaults to `() => true`. The documented
`missing-artifact-path` refusal cannot fire in a real run. A code
comment says every real caller wires `fs.existsSync`; the comment is
false. A gate is only as real as its wiring.

**5. The typo that never stops firing (P2, input boundaries).**
`cw schedule create` checks its numbers only for "is finite".
`--interval -100` passes, puts `nextRunAt` in the past, and the task
is then due on every daemon tick, forever — a runaway that spawns
agent work without pause, from one ordinary typo. The right guard
(`clampInt`, positive-bounds checks) exists in the codebase; this
call site does not use it.

## The patterns under the findings

Take the two dozen findings together and a few deeper shapes come
out. These, not the line numbers, are the point of the exercise:

- **A lock on the write is not a lock on the read-change-write.**
  Every lost-update bug in the run had this shape. The write was
  atomic and durable and locked — and the value written was stale.
- **Resume paths are the least-walked paths.** They run only after a
  failure, so they get the least testing — and they break exactly
  where they matter most. If a system promises "re-run to resume",
  every failure point needs a test that kills and re-runs.
- **The safe tools were all there.** Atomic writes, file locks,
  bounds-checked number parsing, path containment — the codebase has
  every one. Almost every finding was a call site that did not use
  the tool sitting one import away. Robustness is not a library; it
  is coverage.
- **A comment that says "safe" is not a wire that makes it safe.**
  The strongest finding of the fail-closed lens was a gate whose
  comment said all callers wire it — and none did. Trust wiring, not
  prose.
- **Cross-confirmation is the best signal.** When two lenses that
  cannot see each other hit the same defect, re-verification is
  almost a formality. Design your audits so that overlap is possible.

## Use the frame on your own project

The frame is portable — nothing in it is CW-specific but the file
names. The short form of every agent prompt:

```text
You are a robustness reviewer for <project>.
First read <the project's own rules file>. Judge the code by the
project's OWN promises, not by general taste.

Audit lens: <ONE of the five questions above>.

Rules:
- Read the true code before you make any claim. Do not guess.
- Each finding: file:line, one line on the defect, one concrete
  failure story (input/state -> wrong outcome), severity P1/P2/P3.
- No style points. No untraced guesses. Check docs for by-design
  behavior first.
- 3-8 strong findings beat 20 weak ones.
```

Run five of these side by side, one lens each. Then — the step that
is not optional — re-check every finding against the source before
you believe it, and only then rank and report.

## What happens next

The audit output is the map, not the fix. As with every past
campaign, the findings become separate PRs — one defect class per PR,
in severity order, each with a test that fails before the change and
passes after it. When they land, this page gets a closing note, the
same way the release-trust audit got its #443–#449 line.

## Closing note — the fixes landed (PRs #450–#464)

The whole set is in. The 24 findings became **15 PRs, all merged** to
`main` — **24 of 24 fixed**. All four P1s landed: the telemetry ledger
lock (#454), the child-process termination fix (#457), the drive-round
mutex (#460), and the release resume re-push (#462).

The one finding held back — an agent timeout leaving its vendor CLI
running as an orphan — came back as its own follow-up (#464). The
first attempt at it had used a `detached` spawn that would have stopped
Ctrl-C from reaching the worker; the redo instead has cw record each
vendor's PID and reap it on a timeout, so the wrapper stays in cw's
process group and Ctrl-C still works. The adversarial reviewer bit
once more here too: it passed the design but caught that one of the
four shipped vendor wrappers had been missed — so the reaper now has a
test that fails if any future vendor is added without it.

The run itself is a small case study in the method:

- **Two fan-outs, then a babysit loop.** One workflow put 14 fixers
  in 14 isolated worktrees — test-first, fix, build, PR — each paired
  with an adversarial reviewer. A second workflow rebased and
  fixed-forward. Then a loop merged them as CI went green.
- **The reviewer earned its keep four times.** It caught a *new*
  regression a fixer introduced (a `detached` spawn that would have
  stopped Ctrl-C from reaching a worker), a normal-path output change
  that broke a conformance case, a crash-on-bad-input that a first fix
  left on the wrong code path, and — in the follow-up — a vendor
  wrapper that had been missed so a whole class of agent still leaked.
  None of these would have failed the fixer's own tests; only a
  second, skeptical pass found them.
- **The bookkeeping files serialised the merges.** Two append-only
  files (`ITERATION_LOG.md`, since removed, and the project index) meant every merge
  re-conflicted the rest, so the PRs landed one at a time with a
  rebase between each — a `merge=union` rule and a regen step made
  that mechanical.

The lesson under the lessons: an audit is only done when the map is
walked. Finding two dozen real defects was the cheap half; landing
them without breaking the byte-for-byte contract the project promises
was the rest of the work.

---

*See also: [Origin Story](Origin-Story.md) for how CW started and the
FreeBSD discipline these lenses test against, and
[Trust And Audit](Trust-And-Audit.md) for what the ledgers prove.*

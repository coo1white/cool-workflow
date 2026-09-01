# Getting Started

A ten-minute walk-through: install CW, watch it catch a forged record with
**no agent needed**, run your first review, read and re-check the report, then
resume and share it.

*Already know the shape? The [Quickstart](Quickstart.md) has the same steps as
a fast command reference.*

## What you need first

- **Node.js v18 or newer** — check with `node --version`.
- **One agent CLI** on your `PATH` for the real review in Step 3: `claude`,
  `codex`, `gemini`, `opencode`, or `muse`. An "agent CLI" is a command-line AI tool
  that can read code and answer questions — for example, Claude Code gives you
  the `claude` command. (Step 2 needs no agent at all.)

## 1 · Install

```bash
npm install -g cool-workflow
cw version            # prints the installed release
```

<details>
<summary>Prefer Homebrew?</summary>

```bash
brew tap coo1white/cool-workflow https://github.com/coo1white/cool-workflow
brew install coo1white/cool-workflow/cool-workflow
```
</details>

If anything looks off, `cw doctor` checks your setup and `cw fix` prints the
exact commands that put it right.

## 2 · See it work — 30 seconds, no agent

```bash
cw demo tamper
# → VERDICT: tamper-evidence holds ✓
```

**What just happened:** CW built a real, signed ledger — a record file where
each entry is chained to the one before it, so any later edit shows. Then it
forged that record three ways — editing the ledger, the signature, and a
signed finding — and caught all three **offline, with only the public key.**
This is the trust machinery the rest of this page builds on. CW signs nothing
itself: your agent signs, CW only checks.

## 3 · Your first review

From inside a project (or point `-dir` anywhere):

```bash
cw -q "How does auth work end-to-end here?"
```

Any question works, not only a risk audit. CW finds the current repo and the
first agent on your `PATH` by itself. Want a specific agent? Add a flag:

```bash
cw -q "What are the security risks?" -claude     # or -codex / -gemini / -deepseek / -muse
```

As it runs you get a calm **live view** — a small rolling window of the
agent's tool calls that updates in place, in the style of Claude Code:

```text
● Read(execution-backend.ts)
  ⎿ 910 lines
● Grep(spawnSync)
  ⎿ 17 matches
✶ Searching worker-isolation.ts… (3s)
```

When it is done, CW prints a short findings table and the saved report path:

```text
==> Map ✓ (6/6)
==> Verdict ✓

Findings: 3 — 2×P1, 1×P2
✓ Report: /path/to/project/.cw/runs/<run-id>/report.md
  Next: cw report <run-id> --show
```

> **Got `status: blocked`?** No agent was found. Run `cw doctor`, or set
> `CW_AGENT_COMMAND=builtin:claude`, or pass `-claude`. CW fails closed — it
> saves the run state as-is, and never makes up a completed result.

## 4 · Read the report

```bash
cw report <run-id> --show          # or: cat .cw/runs/<run-id>/report.md
```

Every finding has a clickable `file.ts:42` pointer back to the evidence. The
whole run lives on disk as files you can open:

```text
<repo>/.cw/runs/<run-id>/
  state.json         # where the run is right now — resume it, diff it
  report.md          # the report, every claim tied to its source
  results/           # each worker's result, with its evidence attached
  workers/           # each worker's full transcript (what it said and did)
  audit/             # records of every decision, policy, and source
  telemetry.json     # the signed usage ledger — any later edit shows
  commits/           # checkpoints of state that passed the checks
```

## 5 · Check it again — offline, by anyone

Re-run the proof on your own machine:

```bash
cw telemetry verify <run-id>       # re-checks the record chain (+ ed25519 if a key is given)
cw audit verify <run-id>           # re-checks the trust-audit chain
```

Hand the result to someone else — they need nothing but the file:

```bash
cw -q "…" --bundle                              # seal the run into one portable file
cw report verify-bundle report.cwrun.json       # they re-check it offline
cw report verify-bundle report.cwrun.json --require-signatures
```

See [Trust And Audit](Trust-And-Audit.md) for exactly what this proves — and
what it does not.

## 6 · Resume, restore, replay

Runs are saved, so you can stop and go on later — or move a run to another
machine:

```bash
cw quickstart architecture-review --run <run-id> --resume
cw run export <run-id> --output run.cw-archive.json
cw run import run.cw-archive.json --target /path/to/restored-repo
```

More in [Recovery And Restore](Recovery-And-Restore.md).

## 7 · Beyond code

CW reads any folder of files as sources — your docs, notes, or papers:

```bash
cw quickstart research-synthesis --repo /path/to/papers \
  --question "What do these papers conclude?"
```

See everything installed with `cw app list`; see [Workflow Apps](Workflow-Apps.md).

## 8 · From your editor (MCP)

MCP is a standard way for editors and AI tools to call other tools. CW offers
its runtime over MCP too, so **Claude Desktop, Cursor, and VS Code** can call
it — plan a run, drive it, and verify a report without leaving the editor.
See [MCP And Manifests](MCP-And-Manifests.md).

---

**Where to next:** [Mental Model](Mental-Model.md) for the *why* ·
[Glossary](Glossary.md) for the words · [Workflow Apps](Workflow-Apps.md) to
pick a job.

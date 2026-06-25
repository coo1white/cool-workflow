# Getting Started

A ten-minute walkthrough: install CW, prove its tamper-evidence with **no agent**, run your first cited
review, read and re-verify the report, then resume and share it.

## Prerequisites

- **Node.js v18+** — check with `node --version`.
- **One agent CLI** on your `PATH` for the real review in Step 3: `claude`, `codex`, `gemini`, or
  `opencode`. (Step 2 needs no agent at all.)

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

If anything looks off, `cw doctor` inspects your setup and `cw fix` prints the exact commands to fix it.

## 2 · Prove it works — 30 seconds, no agent

```bash
cw demo tamper
# → VERDICT: tamper-evidence holds ✓
```

**What just happened:** CW built a real, signed telemetry ledger, forged it three ways — editing the
ledger, the signature, and a signed finding — and caught all three **offline, with only the public
key.** That is the trust mechanism the rest of this page builds on. CW signs nothing with a private key
of its own; your agent signs, and CW verifies.

## 3 · Your first cited review

From inside a project (or point `-dir` anywhere):

```bash
cw -q "What are the main risks here?"
```

CW auto-detects the current repo and the first agent on your `PATH`. Pin a specific one with a flag:

```bash
cw -q "What are the security risks?" -claude     # or -codex / -gemini / -deepseek
```

As it runs you'll see a calm, Claude-Code-style **live view** — a compact rolling window of tool calls
that updates in place:

```text
● Read(execution-backend.ts)
  ⎿ 910 lines
● Grep(spawnSync)
  ⎿ 17 matches
✶ Searching worker-isolation.ts… (3s)
```

When it finishes, CW prints a compact findings table and the saved report path:

```text
==> Map ✓ (6/6)
==> Verdict ✓

Findings: 3 — 2×P1, 1×P2
✓ Report: /path/to/project/.cw/runs/<run-id>/report.md
  Next: cw report <run-id> --show
```

> **`status: blocked`?** No agent was found. Run `cw doctor`, or set `CW_AGENT_COMMAND=builtin:claude`
> / pass `-claude`. CW fails closed — it records the run state but never invents a completion.

## 4 · Read the report

```bash
cw report <run-id> --show          # or: cat .cw/runs/<run-id>/report.md
```

Every finding carries a clickable `file.ts:42` pointer back to the evidence. The whole run lives on
disk as inspectable files:

```text
<repo>/.cw/runs/<run-id>/
  state.json         # the explicit state machine — resumable, diffable
  report.md          # the cited report
  results/           # each worker's result envelope
  workers/           # per-worker transcripts (full narration + tool I/O)
  audit/             # provenance, policy, and decision records
  telemetry.json     # the hash-chained, signed usage ledger
  commits/           # verified state checkpoints
```

## 5 · Re-verify — offline, by anyone

Re-prove the record on your own machine:

```bash
cw telemetry verify <run-id>       # re-checks the hash chain (+ ed25519 if a key is supplied)
cw audit verify <run-id>           # re-checks the trust-audit chain
```

Hand the result to someone else — they need nothing but the file:

```bash
cw -q "…" --bundle                              # seal the run into one portable file
cw report verify-bundle report.cwrun.json       # they re-check it offline
cw report verify-bundle report.cwrun.json --require-signatures
```

See [Trust And Audit](Trust-And-Audit.md) for exactly what this proves (and what it doesn't).

## 6 · Resume, restore, replay

Runs are durable, so you can stop and continue — or move one to another machine:

```bash
cw quickstart architecture-review --run <run-id> --resume
cw run export <run-id> --output run.cw-archive.json
cw run import run.cw-archive.json --target /path/to/restored-repo
```

More in [Recovery And Restore](Recovery-And-Restore.md).

## 7 · Beyond code

CW reviews any folder of files as sources — your docs, notes, or papers:

```bash
cw quickstart research-synthesis --repo /path/to/papers \
  --question "What do these papers conclude?"
```

Browse everything installed with `cw app list`; see [Workflow Apps](Workflow-Apps.md).

## 8 · From your editor (MCP)

CW exposes the same runtime over **MCP**, so **Claude Desktop, Cursor, and VS Code** can call it as a
tool — plan a run, drive it, and verify a report without leaving the editor. See
[MCP And Manifests](MCP-And-Manifests.md).

---

**Where to next:** [Mental Model](Mental-Model.md) for the *why* · [Glossary](Glossary.md) for the
vocabulary · [Workflow Apps](Workflow-Apps.md) to pick a job.

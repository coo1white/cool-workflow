---
name: cool-workflow
description: >-
  Use when the user asks for Cool Workflow or CW: an evidence-gated review of a
  repository by an outside agent, a report they can verify offline, or a
  receipt that a command (such as the tests) truly passed.
---

# Cool Workflow

Cool Workflow (CW) keeps the books for AI work. An outside agent CLI does the
work; CW records each claim with the lines it rests on, accepts only results
whose evidence resolves to real files and lines, commits the run, and writes a
report that anyone can check offline.

**CW never runs a model, never holds a key, and never uploads code.** The
agent host still enforces OS, process and network limits.

## When To Use

- The user asks for `Cool Workflow` or `CW`.
- A question about a repository should be answered with evidence a person can
  check (`cw -q`).
- The user wants proof that a command passed, not just a claim (`cw check`).
- The user wants to seal a run into one file and check it later
  (`cw report bundle`, `cw report verify-bundle`).

## The One Loop

```text
cw -q "<question>" [-claude|-codex|-gemini|-opencode|-deepseek|-muse|-copilot|-antigravity|-grok] [--repo PATH]
```

CW plans the `architecture-review` workflow, hands each worker to the agent,
collects each `result.md`, refuses results without grounded evidence (retry,
then park after three tries), makes one verifier-gated commit, and writes
`.cw/runs/<run-id>/report.md` and `report.html`.

Exit codes: `0` done, `2` stopped (`blocked` or parked: the report says why),
`1` an error. After a stop, fix the cause and run
`cw --resume --run <run-id>`.

## Essential Commands

```bash
cw -q "Is this architecture sound?" -claude --repo <path>
cw --resume --run <run-id>
cw report [run-id] --show          # print report.md (--open opens report.html)
cw report bundle <run-id>          # seal the run into one file
cw report verify-bundle <bundle>   # check it offline; fails closed
cw check -- npm test               # keep a receipt; cite it as receipt:<id>
cw check list
cw check show <receipt-id>
cw version
```

Pass `--json` for machine output; read exit codes, not words on stdout. See
`references/commands.md` for each flag.

## Result Quality

When CW hands a task to you as the agent, write `result.md` with a fenced
`cw:result` JSON block: `summary`, `findings`, `evidence`. Evidence is a
`path:line` locator, a URL, or a `namespace:value` token such as
`receipt:<id>`. Every P0, P1 or P2 finding needs its own grounded evidence,
and every cited file and line must exist. Keep results short; no raw logs
unless they are the evidence.

## Release Discipline

Run `npm run release:check` (in `plugins/cool-workflow`) before handing a cut
to the operator. It is a dry-run gate: docs presence, build, `dist:check`,
purity, language policy, type check and the 10,000-line size gate, tests,
unit tests, vendor-manifest drift, `version:sync` and `readme:check`. It
never tags, pushes or publishes. Patch releases are tagged by CI; a minor or
major is the operator's signed cut.

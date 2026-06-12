---
name: design-qa
description: >-
  Evaluate Cool Workflow architecture, product design, operator UX,
  context-pack, workflow-app, MCP/CLI, or release-process proposals. Use when
  Codex must decide whether a design respects FreeBSD/POLA,
  mechanism-not-policy, stable JSON surfaces, evidence, and verifier boundaries
  before implementation.
---

# Design QA

## Overview

Design QA checks whether a proposed capability belongs in the kernel,
userland, a manifest, a wrapper, a routine, or an eval before implementation.

## Workflow

1. State the user capability in one sentence.
2. Identify the contract surface: CLI, MCP, `.cw/` state, file layout, docs,
   package contents, or external wrapper.
3. Separate mechanism from policy. Move policy into data, apps, wrappers, env,
   or docs.
4. Check POLA: existing outputs, flags, exit codes, and file layouts stay
   byte-identical unless a new opt-in surface is used.
5. Define verifier evidence: tests, manifests, screenshots for UI, replay, or
   logs.
6. Decide whether the work needs a new eval case or skill update.

## Checks

- Does it preserve stdout-as-data?
- Does it fail closed instead of guessing?
- Does it avoid vendor-specific parsing in `src/`?
- Does it keep generated files verifiable?
- Does it have a man page or docs contract?
- Can maker and verifier run in separate worktrees?

## Output Rules

Return:

1. Verdict: acceptable, revise, or reject.
2. Required contract shape.
3. Verification plan.
4. Risks and non-goals.

Do not turn design QA into implementation unless the user asks to proceed.

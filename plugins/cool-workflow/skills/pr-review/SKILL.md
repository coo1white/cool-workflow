---
name: pr-review
description: >-
  Review Cool Workflow pull requests or branch diffs. Use when Codex must
  inspect code changes for bugs, regressions, FreeBSD/POLA violations, missing
  tests, generated artifact drift, release-contract risk, or CI implications,
  and return findings first with file/line citations.
---

# PR Review

## Overview

Review for correctness and release risk before style. Findings lead; summaries
are secondary. Treat missing tests and POLA drift as real risks.

## Workflow

1. Read the diff and identify touched contracts: CLI, MCP, `.cw/` state, docs,
   dist, manifests, tests, release flow, or public package files.
2. Inspect the surrounding code for behavioral expectations.
3. Check whether tests exercise the changed behavior and fail closed.
4. Look for stdout chatter, silent fallback, hidden policy in core, untracked
   generated drift, and accidental public-output changes.
5. Report findings first, ordered by severity, with file and line references.
6. Include open questions only when they block confidence.

## Review Rules

- Do not request cosmetic rewrites unless they hide a bug.
- Do not approve undocumented shipped behavior.
- Do not accept type-only additions without runtime behavior.
- Do not accept `dist/` edits without matching `src/` changes.
- For UI work, require screenshots or browser verification.

## Output Shape

Use this order:

1. Findings
2. Open questions
3. Test gaps
4. Short summary

If there are no findings, say so clearly and name residual risk.

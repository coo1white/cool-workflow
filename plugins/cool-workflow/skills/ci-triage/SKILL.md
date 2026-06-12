---
name: ci-triage
description: Diagnose failing CI, build, release-gate, or test runs for Cool Workflow. Use when a GitHub Actions check, local `npm test`, `npm run build`, release gate, smoke test, or generated-manifest check fails and Codex must identify the first actionable failure with logs and verifier commands.
---

# CI Triage

## Overview

Triage the failure before editing. Keep stdout/log evidence separate from
diagnosis, identify the first failing command, and end with one verifier command
that proves the proposed fix.

## Workflow

1. Capture the failing command, exit code, and the earliest meaningful error.
2. Classify the failure as code, test expectation, generated artifact drift,
   environment, timeout, or external service.
3. Inspect only the files needed to explain that first failure.
4. Propose or implement the smallest fix.
5. Run the narrow verifier first, then the full gate when the fix is plausible.
6. Write the lesson back to `PROJECT_MEMORY.md`, an eval case, or the matching
   workflow skill when the failure pattern is likely to recur.

## Commands

```bash
npm run build
npm test
npm run gen:manifests -- --check
npm run index:check
git diff --check
```

Use smoke tests directly for narrow verification:

```bash
node test/<name>-smoke.js
```

## Output Rules

- Lead with the failing command and root cause.
- Quote only the shortest relevant log lines.
- Separate "confirmed" from "inference".
- Include the verifier commands actually run or still required.

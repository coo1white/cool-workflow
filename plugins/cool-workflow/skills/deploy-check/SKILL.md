---
name: deploy-check
description: Verify Cool Workflow release, publish, deploy, or package readiness. Use when Codex must check build/test gates, generated manifests, project index sync, dist/source contract, changelog/release notes, npm package contents, or pre-tag risk before shipping.
---

# Deploy Check

## Overview

Deploy check is the verifier side of release work. It confirms the artifact a
user receives matches the source, docs, manifests, and stated capability.

## Workflow

1. Confirm the intended capability and release scope.
2. Inspect branch status and generated artifact drift.
3. Run the deterministic gates.
4. Check docs/man-page coverage for shipped behavior.
5. Check package contents and `dist/` policy.
6. Report risk before any tag or publish step.

## Commands

```bash
npm run build
npm test
npm run gen:manifests -- --check
npm run index:check
npm run version:sync
npm run release:check
git diff --check
```

For package inspection:

```bash
npm pack --dry-run
```

## Red Lines

- Do not tag without test evidence.
- Do not write reviewer verdict files by hand.
- Do not silently skip `dist/` drift if the package still ships `dist/`.
- Do not publish undocumented behavior.
- Do not call a release ready if generated manifests or project index drift.

## Output Rules

Return a ship/no-ship verdict, gate results, artifact risks, and the next
operator action.

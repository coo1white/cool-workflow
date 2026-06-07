# Dogfood One Real Repo

The canonical documentation lives in
`plugins/cool-workflow/docs/dogfood-one-real-repo.7.md`.

Cool Workflow v0.1.16 adds `npm run dogfood:release`, a dry-run command that
uses the real repository, the canonical `release-cut` app, isolated CW workers,
candidate scoring, verifier-gated commit/checkpoint state, report generation,
and trust audit provenance to prove the release workflow end to end.

From `plugins/cool-workflow`:

```bash
npm run dogfood:release
node scripts/cw.js status <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
```

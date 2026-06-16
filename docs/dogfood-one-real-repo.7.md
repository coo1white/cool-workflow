# Dogfood One Real Repo

The main docs are kept in
`plugins/cool-workflow/docs/dogfood-one-real-repo.7.md`.

Cool Workflow v0.1.16 adds `npm run dogfood:release`, a dry-run command that
uses the real repository, the main `release-cut` app, separate CW workers,
candidate scoring, verifier-gated commit/checkpoint state, report generation,
and trust audit provenance to show that the release workflow works from start
to end.

From `plugins/cool-workflow`:

```bash
npm run dogfood:release
node scripts/cw.js status <run-id>
node scripts/cw.js report <run-id> --show
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
```

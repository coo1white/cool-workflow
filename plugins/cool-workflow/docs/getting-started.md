# Getting Started

From a fresh clone:

```bash
cd plugins/cool-workflow
npm install
npm run build
node scripts/cw.js app list
```

Create a run with a canonical workflow app:

```bash
node scripts/cw.js plan release-cut \
  --repo "$PWD" \
  --version 0.1.14 \
  --previousVersion 0.1.13 \
  --releaseBranch main \
  --dryRun true
```

Use the returned run id:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js dispatch <run-id> --limit 1 --sandbox readonly
node scripts/cw.js worker summary <run-id>
node scripts/cw.js report <run-id> --show
```

Run the deterministic regression commands:

```bash
npm run check
npm test
npm run canonical-apps
npm run golden-path
npm run fixture-compat
```

Before cutting a release, run the full dry-run gate:

```bash
npm run release:check
```

The release check is non-destructive. It builds, type-checks, runs tests,
validates canonical apps and golden path behavior, checks old fixture
compatibility, verifies docs, and checks version synchronization. It does not
tag, push, publish, or rewrite fixture files.

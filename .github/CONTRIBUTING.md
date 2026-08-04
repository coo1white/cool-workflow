# Contributing

Thanks for helping improve Cool Workflow.

## Development

```bash
cd plugins/cool-workflow
npm install
npm run build
npm run check
node scripts/cw.js list
```

Remove local dependencies before packaging or committing:

```bash
rm -rf node_modules
```

## Plugin Packaging Rules

- Keep the package manifest valid.
- Keep `dist/` committed so users can run the plugin without installing dev
  dependencies.
- Do not commit `node_modules/`, `.cw/`, local run data, or machine-specific
  absolute paths.
- Keep workflow definitions in `workflows/*.workflow.js` runtime-compatible
  with Node.js and Bun.
- Keep TypeScript source in `src/` and rebuild before release.

## Verification

Before opening a pull request, run what CI will run:

```bash
cd plugins/cool-workflow
npm install
npm run build
npm run check
npm run test:coverage          # the full smoke suite under the 80% coverage floor
npm run test:unit              # the pure core/ unit tests
node ../../v2/conformance/run.js --bin dist/cli.js   # byte-exact CLI conformance
npm run release:check -- --skip-tests   # every other gate (parity, manifests, index, lang policy, ...)
```

The binding rules for all work in this repo live in `AGENTS.md` — read it
first; PRs that break its hard rules are rejected in review regardless of
content.

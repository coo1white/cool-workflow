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

Before opening a pull request:

```bash
cd plugins/cool-workflow
npm install
npm run build
npm run check
node scripts/cw.js list
node scripts/cw.js schedule list
rm -rf node_modules
```

If you have local package validation tools available, run them before opening a
pull request.

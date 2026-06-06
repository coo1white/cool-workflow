# Release Checklist

Use this checklist before publishing a new Cool Workflow release.

1. Update `plugins/cool-workflow/package.json`.
2. Update the package manifest.
3. Rebuild and check the TypeScript runtime:

```bash
cd plugins/cool-workflow
npm install
npm run build
npm run check
node scripts/cw.js list
node scripts/cw.js schedule list
rm -rf node_modules
```

4. Validate the package manifest when local validation tools are available.

5. Confirm the public marketplace catalog points at the plugin:

```bash
cat .agents/plugins/marketplace.json
```

6. Tag the release:

```bash
git tag v0.1.1
git push origin main --tags
```

Users can clone the repository and run `plugins/cool-workflow/scripts/cw.js`.

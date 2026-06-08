# Vendor Manifest Source of Truth

Every agent host scans a different, hard-coded manifest directory
(`.claude-plugin/`, `.codex-plugin/`, `.agents/`) with a different JSON shape.
You cannot unify the directory or the schema — so we do not try. Instead, all
vendor manifests are **generated** from one neutral source and point at the same
shared runtime (`skills/`, `dist/`, `apps/`, the MCP server). No vendor forks the
logic; each manifest is a thin adapter.

This is the mechanism/policy split: shared assets are mechanism, per-vendor
manifests are policy.

## Edit here, generate the rest

- **Source of truth:** `plugin.manifest.json` (this directory). Edit only this.
- **Generator:** `../scripts/gen-manifests.js`.

```bash
npm run gen:manifests          # regenerate every vendor manifest
npm run gen:manifests -- --check   # fail (exit 1) if any generated file drifted
```

`--check` runs inside `npm run release:check`, so drift is release-blocking.
`npm run version:sync` verifies the source version matches every surface.

## Generated outputs (do NOT hand-edit)

| Vendor | Marketplace | Plugin manifest | MCP config | MCP path var |
| --- | --- | --- | --- | --- |
| Claude Code | `../../../.claude-plugin/marketplace.json` | `../.claude-plugin/plugin.json` | `../.mcp.json` (auto-discovered) | `${CLAUDE_PLUGIN_ROOT}/` |
| Codex / `.agents` | `../../../.agents/plugins/marketplace.json` | `../.codex-plugin/plugin.json` | `../.codex-plugin/mcp.json` | `./` |

The two vendors read **different** MCP files, so the plugin-root path variable
never collides.

## Adding a new vendor (Cursor, Windsurf, …)

1. Add a `targets.<vendor>` entry in `plugin.manifest.json` (its manifest path,
   mcp path, and `pluginRootVar`).
2. Add a matching adapter branch in `gen-manifests.js`.
3. Run `npm run gen:manifests`. Shared assets stay untouched.

# Operations

## Local Verification

From `plugins/cool-workflow`:

```bash
npm run build
npm test
npm run release:check
```

`release:check` is non-destructive. It builds, type-checks, runs tests, checks
canonical apps, golden-path behavior, CLI/MCP parity, manifest drift, and version
surface synchronization.

Run focused checks:

```bash
npm run golden-path
npm run manifest:load-check
npm run parity:check
npm run gen:manifests -- --check
```

## Manifests

The source of truth is:

```text
plugins/cool-workflow/manifest/plugin.manifest.json
```

Regenerate vendor outputs:

```bash
npm run gen:manifests
```

Check for drift:

```bash
npm run gen:manifests -- --check
```

Generated plugin manifests and MCP configs are adapters. They should not fork
runtime behavior.

For the vendor target list and MCP parity model, see
[MCP And Manifests](MCP-And-Manifests.md).

## Agent Configuration

CW delegates to the agent you configure. Common routes are:

```bash
CW_AGENT_COMMAND="claude -p {{input}}"
CW_AGENT_COMMAND="codex exec {{input}}"
CW_AGENT_ENDPOINT="https://example.internal/agent"
```

The bundled Claude wrapper used by the README quickstart is:

```bash
--agent-command builtin:claude
```

Model choice is policy. The recorded model is what the external agent reports
back; CW does not overwrite it with an operator hint.

## Restore And Recovery

Export a run:

```bash
cw run export <run-id> --output run.cw-archive.json
```

Inspect before restoring:

```bash
cw run inspect-archive run.cw-archive.json
```

Restore:

```bash
cw run import run.cw-archive.json --target /path/to/target-repo
cw run verify-import <run-id> --cwd /path/to/target-repo --strict
```

For stricter import behavior, set:

```bash
CW_REQUIRE_ARCHIVE_INTEGRITY=1
```

That refuses archives missing the top-level integrity block before any write.

For the operator flow and failure modes, see
[Recovery And Restore](Recovery-And-Restore.md).

## Workbench

The Workbench is optional, localhost-only, and read-only:

```bash
cw workbench serve --port 8787
cw workbench serve --once --json
```

It renders existing `.cw/` run state and capability payloads. It is not a
dashboard database and does not own state.

## Release Flow

The portable release orchestrator is:

```bash
node plugins/cool-workflow/scripts/release-flow.js --check
```

The independent review step is delegated to your configured agent command or
endpoint. Do not write the verdict file by hand.

## Operational Checklist

Before treating a run as evidence:

1. Confirm the report path is under the intended repo.
2. Run `cw telemetry verify <run-id>` when telemetry exists.
3. Run `cw audit verify <run-id>` for trust-audit integrity.
4. If the run was restored, run `cw run verify-import <run-id> --strict`.
5. Keep the original `.cw/runs/<run-id>/` directory or exported archive with the
   report you share.

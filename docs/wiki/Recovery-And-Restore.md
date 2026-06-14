# Recovery And Restore

CW stores runs as durable files under `.cw/runs/<run-id>/`. That makes a run
inspectable, resumable, exportable, and restorable without trusting scrollback.

## Resume A Run

Read the next action without mutation:

```bash
cw run resume <run-id>
```

Continue through the agent drive loop:

```bash
cw run resume <run-id> --drive
```

Advance one step:

```bash
cw run resume <run-id> --drive --once
```

The default resume payload is read-only. Adding `--drive` reuses existing pending
tasks and does not re-plan the run.

## Export A Run

```bash
cw run export <run-id> --output run.cw-archive.json
```

The archive includes run state, run-local files, committed artifacts, audit
overlays, telemetry ledgers, per-file digests, file sizes, and a manifest digest.
The source run is not mutated.

## Inspect Before Import

```bash
cw run inspect-archive run.cw-archive.json
cw run inspect-archive run.cw-archive.json --json
```

Inspection is read-only. It recomputes embedded file digests, file sizes, the
file count, the manifest digest, and the whole-archive hash. If `ok:false`, the
command exits nonzero so it can guard an import.

## Import And Verify

```bash
cw run import run.cw-archive.json --target /path/to/restored-repo
cw run verify-import <run-id> --cwd /path/to/restored-repo --strict
```

Import restores under:

```text
/path/to/restored-repo/.cw/runs/<run-id>/
```

It rebases paths to the target repo, writes `import-manifest.json`, refreshes the
target repo registry, and immediately runs restore verification.

`verify-import --strict` turns a failed verification into a nonzero exit. Use it
in scripts before trusting a restored run.

## Stricter Integrity Policy

```bash
CW_REQUIRE_ARCHIVE_INTEGRITY=1 cw run inspect-archive run.cw-archive.json
CW_REQUIRE_ARCHIVE_INTEGRITY=1 cw run import run.cw-archive.json --target /path/to/restored-repo
```

With the env set, archives missing the top-level integrity block are refused
before restore writes. Without it, legacy integrity-less archives keep their
historical behavior.

## Rerun A Failed Run

```bash
cw run rerun <run-id> --reason "retry after restoring archive"
```

Rerun creates a new run linked to the original by provenance. The original run is
preserved for audit.

## Failure Modes

| Failure | Result |
| --- | --- |
| Digest mismatch | Import or verify reports the offending file. |
| Unsupported archive schema | Reported as a failed check. |
| Path escape | Refused. |
| Missing restore manifest | `verify-import` fails. |
| Telemetry chain failure | Verification reports the chain failure. |
| Trust-audit chain failure | Verification reports `trust-audit-invalid`. |

## Related Pages

- [Trust And Audit](Trust-And-Audit.md)
- [Operations](Operations.md)
- [Commands or API](Commands-or-API.md)

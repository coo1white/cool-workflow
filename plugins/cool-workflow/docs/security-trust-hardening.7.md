# Security / Trust Hardening

What CW refuses, and why. CW is not an OS sandbox: the agent host must still
give OS-level read and write isolation, process and network limits. CW keeps
the books, and its gates fail closed.

## What an agent gets

CW starts the agent argv-style (`shell: false`), in the repository folder,
with a short, fixed env: `PATH`, `HOME`, `USER`, provider-key names
(`CW_`, `ANTHROPIC_`, `CLAUDE_`, `OPENAI_`, `GEMINI_`, ...) and the proxy and
CA settings. Four names are never passed on, whatever their prefix:

- `CW_RELEASE_VERDICT_PRIVKEY` — the release verdict signing key;
- `CW_CHECK_PRIVKEY` — the done-receipt signing key (an agent holding it
  could forge receipts);
- `CW_WORKBENCH_TOKEN`, `CW_BENCH_TRACE_FILE`.

Secret-looking arguments (the value after `--api-key`, `--token`, ...; `sk-`
and `ghp_` tokens; long opaque strings) are written as `<redacted>` wherever
CW records the command it ran.

## What CW takes back

A worker's `result.md` is data. CW refuses it, retries the worker with the
reason at the top of its next `input.md`, and parks it after three tries,
when:

- `result.md` is a symlink or resolves outside the worker's folder;
- a task that needs evidence cites none that is grounded (a `path:line`
  locator, URL, or `namespace:value` token — not free text);
- a P0, P1 or P2 finding has no grounded evidence of its own;
- a repository review cites mostly CW's own `.cw/` run files;
- a cited `cw check` receipt is missing, edited, unsigned when a key is
  set, from a failed command, or stale (the code changed since);
- the verdict cites a file that is not on disk, or a line past its end.

The final commit checks the verdict's evidence once more (see
verifier-gated-commit(7)); a refused commit leaves the run `blocked` with the
reason, and `report.md` is still written.

## Run state

A run's `state.json` is data, not a list of places to write: each load makes
the run's paths again from the folder it was found in. A run id must be one
safe path segment. A `state.json` from before batch 5 is refused with one
line; CW never migrates or repairs state. See durable-state-and-locking(7).

## Telemetry

CW holds only the operator's PUBLIC key. An agent wrapper signs its usage
report and the digest of the result it wrote; CW verifies the
signature on accept and again in `cw report verify-bundle`, and records
`attested`, `unattested` or `absent`. It never measures usage itself. See
trust-model.

## Removed in batch 5

The trust-audit chain (`.cw/runs/<id>/audit/`, `cw audit ...`), sandbox
profiles, worker audit decisions and their MCP tools were removed on
2026-11-12; the signed telemetry ledger is the one chain that stays. See
release-and-migration(7), "Removed in batch 5".

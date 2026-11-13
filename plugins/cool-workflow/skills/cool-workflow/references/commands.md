# Cool Workflow — Command Reference

Every CW command. `SKILL.md` covers the loop; come here for the exact flags.
Run data is written to `.cw/runs/<run-id>/` in the target repository.

## Ask

```bash
cw -q "<question>" [-<vendor>] [-r|--repo PATH] [-d|--dir PATH] [--json] [--quiet] [--verbose] [--no-color]
cw --resume --run <run-id>
```

Vendors: `-claude -codex -gemini -opencode -deepseek -muse -copilot
-antigravity -grok`. With none, CW uses `CW_AGENT_COMMAND`, then
`$CW_HOME/agent-config.json`, then the first of claude, codex, gemini,
opencode, muse found on `PATH` (`CW_NO_AUTO_AGENT=1` turns that off).
`--agent-command`, `--agent-model` and `--agent-timeout-ms` set the agent
for one run.

Exit `0` done, `2` stopped (`blocked` or parked), `1` an error. `--quiet`
hides the `[drive]` lines on stderr; stdout carries only data.

## Report

```bash
cw report [run-id] [--show|--open]
cw report bundle <run-id> [--output FILE] [--with-trust-key PEM] [--extract-report FILE]
cw report verify-bundle <bundle> [--pubkey PEM] [--strict-signatures] [--require-signatures] [--extract-report FILE]
```

With no run id, `cw report` takes the latest run. `verify-bundle` exits 1 on
any failed check and lists them in `failedChecks`.

## Check

```bash
cw check -- <command> [args...]
cw check list
cw check show <receipt-id>
```

`cw check` runs the command with no shell and keeps a receipt in
`.cw/receipts/<id>.json`; a result cites it as `receipt:<id>`. It exits 1
when the command did not exit 0 (the receipt is still kept).
`CW_CHECK_PRIVKEY` signs receipts; `CW_CHECK_PUBKEY` makes runs refuse
unsigned ones.

## Other

```bash
cw version
cw help [command]
```

## Release & maintenance npm scripts

Run in `plugins/cool-workflow`:

```bash
npm run build          # tsc to dist/ (commit dist/)
npm run check          # type check + the 5,000-line src/ size gate
npm run test:unit      # unit tests
npm test               # smoke tests
npm run version:sync   # version agrees across surfaces
npm run release:check  # dry-run release gate; never tags, pushes or publishes
```

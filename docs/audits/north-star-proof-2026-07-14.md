# North Star Proof — 2026-07-14

This record checks the three product tracks after the structure roadmap. All
paths below use safe names. No user or machine data is kept here.

## Track A — Saved Run Path

Result: PASS.

The check used a clean clone, a clean `HOME`, and a clean global npm prefix.
The one-worker `end-to-end-golden-path` app used the fixed outside-agent
fixture from the conformance set. The product path was:

```text
cw plan end-to-end-golden-path --question "Prove the saved run path"
cw run resume <run-id> --drive --once --scope repo
cw status <run-id> --json
cw run resume <run-id> --drive --scope repo
```

The first drive gave `drive=in-progress`, `workers=1/1`, and one accepted
step. Status gave one completed task. The last resume gave `drive=complete`,
one commit step, and commit `state-0004`. The run record showed about 11
seconds from plan to the inspected completed worker. The full path was well
under five minutes.

This proof first found that human resume text hid the drive result. The same
cycle fixed that text. Bare resume text and all JSON stayed as they were.

## Track B — Move, Check, and Resume

Result: PASS.

The check used two separate temporary roots. A run was taken through one
worker step in the first root, but was not given its terminal commit. Then:

```text
cw run export <run-id> --output $TMP/run.cwrun.json --json
cw run restore $TMP/run.cwrun.json --target $TMP/target --json
cw run verify-import <run-id> --cwd $TMP/target --strict --json
cw run resume <run-id> --drive --scope repo
```

The archive had 25 files. Restore gave `ok:true`. The strict check exited 0.
Resume in the second root made terminal commit `state-0004`.

For the refusal check, one `contentBase64` value was changed without new
hashes. Restore exited 1 with `archive-bad-base64`. The target had no
`.cw/runs` tree after refusal, so no part state was written.

## Track C — Two Real MCP Clients

Result: PASS.

Claude Code 2.1.191 loaded the generated Claude plugin manifest. Codex CLI
0.144.1 used the generated Codex command and args from the plugin directory:

```json
{
  "command": "node",
  "args": ["./dist/mcp-server.js"]
}
```

For both clients, the connection gave server name `cool-workflow`, version
`0.2.5`, and tools support. Each client found `cw_list` through its tool list,
called it once, and got `architecture-review` as the first workflow id. The
call is read-only. No model SDK or key was put into CW.

## Verdict

Tracks A, B, and C pass. The structure roadmap is done. New inside-only work
has no place unless a later product proof gives a real blocker.

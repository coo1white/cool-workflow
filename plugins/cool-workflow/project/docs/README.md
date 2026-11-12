# project/docs — the map

The engineering docs of CW: plans, records, audits, and the wiki copy. They
never ship (they are outside the npm `files` list). The man pages that do
ship, the contract for users, are in [`../../docs/`](../../docs/).

Every entry in this folder has one line below.

New to the code? After the folder list come three parts: "The layer
stack", "Walk one command: `cw -q`", and "Decision records".

## Plans and records

| Entry | What it is |
|---|---|
| [`BACKLOG.md`](BACKLOG.md) | Ideas that do not yet help a user get, read, or check a receipt; one row each, deleted when it ships or is dropped. |
| [`ARCHITECTURE_PLAN.md`](ARCHITECTURE_PLAN.md) | The small set of architecture changes still planned. |

## Proof

| Entry | What it is |
|---|---|
| [`audits/`](audits/) | Receipts and verdicts, append-only; never cleaned up. |
| [`publishing-audits.md`](publishing-audits.md) | How to make a cited audit of a repo and put it out with care. |
| [`scripts/`](scripts/) | `verify-audit-cites.js`, which checks every citation in an audit resolves. |
| [`benchmark.md`](benchmark.md) | A measured benchmark run, with its date and CW version. |

## For readers

| Entry | What it is |
|---|---|
| [`wiki/`](wiki/) | The copy of the GitHub wiki pages; published by hand after a release. |
| [`assets/`](assets/) | Images for the README, the wiki, and the launch demo. |

Worked audit examples are in [`../examples/`](../examples/).

## The layer stack

The code is in [`../../src/`](../../src/), in five layers. A layer may
import the layers under it, and never one over it. `cli/` and `mcp/` are
two doors side by side; they do not import each other.

```text
   cw  (scripts/cw.js -> dist/cli.js)         an MCP host  (scripts/mcp-server.js -> dist/mcp-server.js)
        |                                          |
   src/cli/      argv -> one command          src/mcp/   JSON-RPC -> one tool
        |                                          |
        +--------------------+---------------------+
                             v
   src/wiring/   the capability table: every command and every MCP tool,
                 once, as data, with the shell function that does it
                             v
   src/shell/    the work with the outside: files, the .cw/ run folder,
                 processes, git, agents, the clock. The body of each
                 command is in shell/commands/<name>-cli.ts
                             v
   src/core/     decisions and data only: pure functions, no files, no
                 processes, no network. It imports only core/ and node: parts
```

| Layer | What it holds | May import |
|---|---|---|
| [`cli/`](../../src/cli/) | Reads argv, finds the command in the table, prints the output | `core`, `shell`, `wiring`, `cli` |
| [`mcp/`](../../src/mcp/) | The MCP stdio server: finds the tool in the table, gives back JSON | `core`, `shell`, `wiring`, `mcp` |
| [`wiring/`](../../src/wiring/) | The capability table: one row per command or tool, so CLI and MCP give the same thing | `core`, `shell`, `wiring` |
| [`shell/`](../../src/shell/) | Everything with a side effect: run store, drive, dispatch, report, trust audit, agent backends | `core`, `shell` |
| [`core/`](../../src/core/) | Pure rules and data: run state, pipeline steps, hashes, formats, workflow app schema | `core` only |

Two checks keep the rule true:

- [`test/core/layer-direction.test.mjs`](../../test/core/layer-direction.test.mjs)
  (`npm run test:unit`): `core/` imports only `core/` and `node:` parts,
  with no list of let-through breaks at all.
- [`scripts/purity-gate.mjs`](../../scripts/purity-gate.mjs)
  (`npm run purity:check`, run by `release:check`, so by CI): checks every
  layer, and checks that `core/` does not get at files, processes,
  `process.env` or the clock. It is a ratchet: the breaks there are today
  are listed in [`scripts/purity-baseline.json`](../../scripts/purity-baseline.json),
  a new break fails, and a fixed break has to come out of the list.

## Walk one command: `cw -q`

What happens on `cw -q "<question>" -claude`, the core path of
`AGENTS.md`:

1. [`scripts/cw.js`](../../scripts/cw.js) loads `dist/cli.js`, made from
   [`src/cli.ts`](../../src/cli.ts), which calls `main` in
   [`src/cli/entry.ts`](../../src/cli/entry.ts).
2. `entry.ts` turns `-q` into the `quickstart` command and finds its row
   in the capability table,
   [`src/wiring/capability-table/pipeline.ts`](../../src/wiring/capability-table/pipeline.ts).
3. The row's handler is `quickstartRun` in
   [`src/shell/commands/pipeline-cli.ts`](../../src/shell/commands/pipeline-cli.ts).
   It plans the run (`pipeline.ts`, `workflow-app-loader.ts`), then drives
   it (`drive.ts`): each step gives work to the agent (`dispatch.ts`,
   `worker-isolation.ts`, `agent-config.ts`, `sandbox-profile.ts`), takes
   the result back, and saves it (`run-store.ts`, `node-store.ts`,
   `fs-atomic.ts`, `trust-audit.ts`, `observability.ts`).
4. At the end it makes a verifier-gated commit (`commit.ts`) and writes
   `.cw/runs/<id>/report.md` (`report.ts`). `onramp.ts` gives the next
   step when something is missing.
5. The decisions on the way (what step is next, if a result may be
   taken, what the report says) are kept as pure functions in
   `src/core/` (most in `core/pipeline/` and `core/state/`), so they can
   be tested with no files and no agent.

`cw --resume --run <id>` goes the same way, and adds
[`registry-cli.ts`](../../src/shell/commands/registry-cli.ts) and
[`run-registry-io.ts`](../../src/shell/run-registry-io.ts) to find the
run. All files named in steps 3 and 4 are in `src/shell/`.

## Decision records

Why the tree is the way it is. A plan for a big change is in its PR text
(see the root `AGENTS.md`); the older intent, sdlc and rebuild files are in
git history.

| Record | What it decided |
|---|---|
| [`ARCHITECTURE_PLAN.md`](ARCHITECTURE_PLAN.md) | The architecture changes still planned |

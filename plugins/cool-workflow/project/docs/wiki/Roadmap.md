# Roadmap

*Where CW is now, what is being done next, and what was taken out. True to
the released 0.3.3. For the full story of each release, see the
[GitHub Releases](https://github.com/coo1white/cool-workflow/releases).*

## Where CW is now (0.3.3)

CW is a small command-line tool and MCP server that gives the work to your
own agent, checks what comes back, and keeps a record of the run that you
can check again. Its three proof goals are done (see
[the proof record](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/project/docs/audits/north-star-proof-2026-07-14.md)):

- **A — a resumable pipeline in under 5 minutes.** `cw -q "<question>"`
  plans, runs, checks, and writes a report; `cw --resume --run <run-id>`
  goes on after a stop.
- **B — boring recovery.** A run can be exported, moved to another
  machine, checked, and resumed; a part-done run is never shown as done.
- **C — more than one vendor.** One manifest makes the plugin files for
  Claude, Codex, Gemini, OpenCode, and a general `.agents` adapter, and the
  MCP server is loaded by real clients.

## New in 0.3.3

- `cw doctor --conformance` runs your agent one time on a small task and
  checks that it keeps the agent contract, `cw-agent/1`.
- `cw doctor` runs your agent's CLI with `--version`, to see that it truly
  starts.
- `CW_AGENT_IDLE_TIMEOUT_MS` (opt-in) stops an agent that has written
  nothing for that long.
- `CW_AGENT_SANDBOX=srt` (opt-in) runs each agent inside Anthropic's
  sandbox runtime, `srt`.
- An agent that goes past its time limit parks on the first try, not
  after 3 tries.
- Proxy and CA settings (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, and the
  others) now get to the agent, so an agent behind a proxy works.
- `cw init` writes a new app to `./apps`, and `cw app list` shows the apps
  in `./apps` next to the bundled ones.
- `npx cool-workflow ...` and a local `npm i cool-workflow` work again.

## What is next

- **0.4.0: a clean-up of the whole tree.** Shared test helpers, one folder
  for the CLI command code, and the last parts of the removed multi-agent
  family taken out. No output changes: every command, JSON shape, exit
  code, `.cw/` file, MCP tool, and `CW_*` setting stays the same.
- **Reach, not features.** CW can be put on any machine with npm and gives
  a working first run; what it needs now is users, and their reports of
  what is hard.

## Ideas on hold

These are in the repo's
[backlog](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/project/docs/BACKLOG.md),
each with its reason. None is being worked on now:

- a file lock that does not stop the MCP server while it waits;
- running a workflow app's own `workflow.js` in a sandbox (today it runs in
  the CW process, and the run record says so);
- letting `cw` review this repo's own pull requests;
- a smaller `state.json` for runs with very many workers;
- a step that reads one agent's output to decide what to send out next
  (the bounded `loop()` phase is the first step to this).

## Taken out

- **The multi-agent family** — in 0.3.1 (decided 2026-09-28): the
  blackboard, the coordinator, topologies, candidates and their scoring,
  eval, and team review (`cw approve`, `cw reject`, `cw comment`,
  `cw handoff`, `cw review`), with their 75 MCP tools. It was about 12,800
  lines that the core path did not use. Old run state with these fields
  still loads; the fields are kept as data. To get agents working
  together, give the work its shape with a [workflow app](Workflow-Apps.md),
  and hand work between agents in two repos with `cw ledger`.
- **Node.js 18 and 20** — 0.3.1 was the last release for them; CW now
  needs Node.js 22.13 or newer.
- **The frozen surfaces** — on 2026-11-12: scheduling (`cw schedule`,
  `cw loop`, `cw routine`, `cw sched`), the Workbench (`cw workbench`), the
  telemetry demo (`cw demo bundle`), the observability intake (`--pricing`,
  `--usage-*`), and run reclamation (`cw gc`, `cw orphans`, `cw clones`),
  with their 31 MCP tools. `cw demo tamper`, `cw report verify-bundle` and
  the run queue stay. Old run state still loads.

## Related Pages

- [Architecture Principles](Architecture-Principles.md)
- [Origin Story](Origin-Story.md)
- [Side Story](Side-Story.md)

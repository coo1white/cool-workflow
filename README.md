<div align="center">

# Cool Workflow

**Get a saved, cited report from your AI agent — not a chat message you lose.**

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cool-workflow?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/cool-workflow)
[![downloads](https://img.shields.io/npm/dm/cool-workflow?style=flat-square&label=downloads)](https://www.npmjs.com/package/cool-workflow)
[![provenance](https://img.shields.io/badge/npm-provenance-3178C6?style=flat-square)](https://www.npmjs.com/package/cool-workflow)
[![release](https://img.shields.io/github/v/tag/coo1white/cool-workflow?style=flat-square&label=release&color=brightgreen&sort=semver)](https://github.com/coo1white/cool-workflow/tags)
[![license](https://img.shields.io/badge/license-BSD--2--Clause-blue?style=flat-square)](LICENSE)

<img src="docs/assets/cool-workflow-readme-promo.png" alt="Cool Workflow turns AI agent repo questions into saved, cited, tamper-evident reports." width="100%">

</div>

## Install

```bash
npm install -g cool-workflow
```

What you need: **Node.js v18+** (`node --version`) and one AI agent CLI on your machine
(`claude`, `codex`, or `gemini`). No agent? `cw demo` still works — CW never runs a model itself.

## Quick Start (3 steps)

### 1. Prove it works (30 seconds, no agent needed)

```bash
cw demo tamper
# → VERDICT: tamper-evidence holds ✓
```

### 2. Run a review on your code

```bash
cw doctor                    # check your setup (shows which agents are on your machine)
cw quickstart -q "What are the main risks here?"
```

CW auto-detects the repo (current folder) and your agent (first found on PATH).
To be clear, pass the flags by name:

```bash
cw quickstart -q "What are the security risks?" -r /path/to/project -a builtin:claude
```

Want a dry run first? Add `--check` (zero writes). Want to watch the agent work? Set `CW_AGENT_STREAM=1`.

### 3. Open the report

The command prints the report path. For example:

```bash
cat .cw/runs/<run-id>/report.md
# → findings with clickable file.ts:42 pointers for every claim
```

## What Else Can It Do?

```bash
cw list                            # see all built-in workflows
cw info architecture-review        # what a workflow does and what it needs
cw search security                 # find workflows by keyword
cw man release-tooling             # read a manual page
```

| Workflow | Does |
|---|---|
| `architecture-review` | Map a repo, rank risks, back every claim with evidence |
| `pr-review-fix-ci` | Review a pull request, suggest fixes, verify CI |
| `research-synthesis` | Answer a question with fact-backed research |
| `release-cut` | Run a gated, reviewed release |

CW also has an **MCP** surface — Claude Desktop, Cursor, and VS Code can call CW as a tool.
See the [wiki](https://github.com/coo1white/cool-workflow/wiki).

## Can I Trust the Report?

CW does not run the AI model — it keeps the books. Every agent step is recorded, signed, and
hash-chained. Change the report later? The chain breaks and the signature no longer matches.
Anyone can check this offline, with only the public key:

```bash
cw demo tamper                              # proves it in 30s
cw telemetry verify <run-id>                # checks a real run
```

Give the report to another person — they need nothing but the file:

```bash
cw quickstart -q "…" --bundle               # seal into one portable file
cw report verify-bundle report.cwrun.json   # they check it offline
```

## Troubleshooting

| Problem | Fix |
|---|---|
| No agent found | Run `cw doctor` — it shows which agents are on your machine |
| `status: blocked` | Set `CW_AGENT_COMMAND=builtin:claude` or pass `-a builtin:claude` |
| `claude: command not found` | Install Claude Code and run again |
| Want a dry run | Add `--check` — zero writes, no agent call |
| Want live agent trace | `CW_AGENT_STREAM=1` (stderr only, TTY-gated) |
| Where is my report? | `<repo>/.cw/runs/<id>/report.md` |
| Need the old README? | See [docs/readme-v0.1.87-full.md](plugins/cool-workflow/docs/readme-v0.1.87-full.md) |

## How It Works

CW is a small TypeScript tool with zero runtime deps. It runs your agent over a repo in steps
(*plan → dispatch → record → verify → commit → report*), saving every result to disk as
inspectable, replayable files. It never imports a model SDK or stores an API key.

`ask simple → run simple → verify simple → resume simple`

For the full API, multi-agent topologies, execution backends, and the CLI/MCP surface,
see the [wiki](https://github.com/coo1white/cool-workflow/wiki).

CW dogfoods its own release process — every cut runs the `release-cut` workflow against this
repo. See the [full README](plugins/cool-workflow/docs/readme-v0.1.87-full.md) for the
pre-v0.1.87 reference.

## License

BSD-2-Clause. Built by COOLWHITE LLC.

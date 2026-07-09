# cli-surface

## Scope

This part covers the `cw` command-line front door: the entry point `src/cli.ts`, the dispatcher `src/cli/command-surface.ts`, the shared helpers `src/cli/io.ts`, `src/cli/format.ts`, `src/cli/run-summary.ts`, and every handler under `src/cli/handlers/` (audit, blackboard, candidate, clones, collaboration, eval, ledger, maintenance, multi-agent, node, operational, operator, orphans, registry, run, scheduling, workbench, worker). It also covers the parse, help, and suggestion functions in `src/orchestrator.ts` (`parseArgv`, `KNOWN_COMMANDS`, `suggestCommand`, `formatHelp`, `formatCommandHelp`, `formatSearchResults`, `formatInfo`), the color and summary primitives in `src/term.ts`, and the end-of-run reporter in `src/reporter.ts`. The business logic behind each verb (runner methods, `capability-core`) is other readers' work; this spec pins what the CLI takes in and what it puts out.

## Public surface

### Binary names

The npm package puts two names on the path, both pointing at `scripts/cw.js` (which loads `dist/cli.js`): `cool-workflow` and `cw` (package.json:4-7). The compiled entry is `dist/cli.js`; `runCli(process.argv.slice(2))` is the exported way in (src/cli.ts:5, src/cli/command-surface.ts:43).

### Argument parsing (`parseArgv`)

`parseArgv(argv)` returns `{ command, positionals, options }` (src/orchestrator.ts:789-838). Rules:

- The first token is `command`, taken as-is (src/orchestrator.ts:794).
- `--` is the POSIX end-of-options mark: every later token is a positional, even one that starts with `--` (src/orchestrator.ts:799-803).
- A token with no leading `-` is a positional (src/orchestrator.ts:805-807).
- A single-dash token `-x` maps through a short-flag table: `q` → `question`, `r` → `repo`, `d` → `dir`, `l` → `link`, `a` → `agent-command`, `h` → `help`, `v` → `version` (src/orchestrator.ts:811). A name not in the table keeps its own name — so `-dir` becomes option `dir`, `-claude` becomes option `claude` (src/orchestrator.ts:814). Joined short flags like `-qr` are NOT taken apart; the key stays `qr`.
- A flag's value is the next token ONLY when that token does not start with `-` (single or double dash). Otherwise the flag's value is `true` (src/orchestrator.ts:815, 828-835). This keeps `run app --drive -dir /p` right: `drive=true`, `dir="/p"`.
- `--key=value` gives a value that may start with `-` (src/orchestrator.ts:823-825). `--` is the second way through.
- A repeated option becomes an array of values (`appendOption`, src/orchestrator.ts:1009-1016).

### Top-level flags and redirects (before the switch)

- `cw --version`, `cw -v` — prints `0.1.98\n` (the value of `CURRENT_COOL_WORKFLOW_VERSION`, src/version.ts:1) and stops (src/cli/command-surface.ts:47-51).
- `cw`, `cw --help`, `cw -h` — prints `formatHelp()` + `\n` (src/cli/command-surface.ts:52-55, 107-109).
- `cw <verb> --help` / `cw <verb> -h` — prints `formatCommandHelp(verb)` + `\n`, the verb's subcommand list from `CAPABILITY_REGISTRY` (src/cli/command-surface.ts:80-83; src/orchestrator.ts:988-1007).
- Vendor short flags map to `--agent-command`: `-claude` → `builtin:claude`, `-codex` → `builtin:codex`, `-gemini` → `builtin:gemini`, `-deepseek` → `builtin:deepseek` (src/cli/command-surface.ts:59-62).
- `-dir` / `--dir` / `-d` is a second name for `--repo`; a given `--repo` wins over `dir` (src/cli/command-surface.ts:65).
- Presentation flags set env vars before any agent spawn, so the out-of-process wrapper gets them: `--verbose` → `CW_VERBOSE=1`; `--no-color` → `CW_NO_COLOR=1`; `--full` → `CW_OUTPUT=full`; `--quiet` → `CW_DRIVE_PROGRESS=0` (src/cli/command-surface.ts:73-75; src/cli/entry.ts).
- `cw -q "text"` or `cw --question "text"` as the FIRST token: the positional is taken off and stored as `options.question` (only when `options.question` is not set), then the command becomes `quickstart` (src/cli/command-surface.ts:88-93). `cw --question=...` with no command also becomes `quickstart` (src/cli/command-surface.ts:91-93).
- `quickstart` / `audit-run` with no `--question` on a TTY: the CLI asks `Question: ` on stderr through readline and waits (src/cli/command-surface.ts:435-445).

### Shared io helpers (src/cli/io.ts)

- `required(value, label)` — throws `Missing <label>.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"` when the value is empty (src/cli/io.ts:6-9).
- `optionalArg(value)` — trimmed non-empty string or `undefined` (src/cli/io.ts:12-14).
- `printJson(value)` — writes `JSON.stringify(value, null, 2)` + `\n` to stdout; never colored (src/cli/io.ts:17-19).
- `wantsJson(options)` — true for `--json` or `--format json` (src/cli/io.ts:22-24).

### Command list (dispatcher switch, src/cli/command-surface.ts:101-431)

| Command | What it does | JSON rule |
| --- | --- | --- |
| `help [topic]` | `formatCommandHelp(topic)` or `formatHelp()` to stdout (line 102-106) | human |
| `version` | prints version (line 110-111) | human |
| `update` | `npm update -g cool-workflow`, then on non-zero `npm install -g cool-workflow@latest`; exit 1 if both fail (line 113-125) | human |
| `fix` | `runDoctor` then `formatDoctorFixes`; exit 1 when `!report.ok` (line 126-131) | human |
| `list` | `printJson(runner.listWorkflows())` (line 132-134) | always JSON |
| `search <kw..>` | filters `runner.listApps()` by title/summary/id; `--json` gives the array, else `formatSearchResults` (line 135-146) | flag |
| `man <topic>` | reads `docs/<topic>.7.md`, then `docs/<topic>.md`, then `docs/<topic>`; writes the raw file to stdout with no added newline (line 147-161) | human |
| `info <app-id>` | `runner.showApp`; `--json` or `formatInfo` (line 162-169) | flag |
| `doctor` | `runDoctor`; `--json` gives report, `--fix` gives `formatDoctorFixes`, else `formatDoctorReport`; exit 1 when `!report.ok` (line 170-177) | flag |
| `init <workflow-id>` | `printJson(runner.init(...))` (line 178-183) | always JSON |
| `app list\|show\|validate\|init\|package\|run [id\|path]` | always JSON; `validate` exits 1 when `!valid` (line 184-211) | always JSON |
| `quickstart [app]` / `audit-run [app]` | one-shot plan → drive → report; `printJson(qs)`; human summary on stderr when not `--json` and result has `runId` + `reportPath`; exit 1 when `mode==="check" && ok===false` or when `bundle.ok===false` (line 212-250) | always JSON + stderr chrome |
| `plan <workflow-id>` | `printJson(planSummary(...))` (line 251-256) | always JSON |
| `status [run-id]` | no id: "No run selected" advice (JSON `{runId:null,nextActions}` under `--json`); with id: `--json` = `runner.status`, else `formatOperatorStatus` or, under `--summary`/`--brief`, `formatOperatorSummary` (line 257-267) | flag |
| `next <run-id>` | `printJson(runner.next(...))` (line 268-269) | always JSON |
| `dispatch <run-id>` | `printJson(runner.dispatch(...))` (line 271-272) | always JSON |
| `result <run-id> <task-id> <result-file>` | `printJson(runner.recordResult(...))` (line 274-285) | always JSON |
| `state check <run-id>` | `printJson`; exit 1 when `status === "unsupported"` (line 286-298) | always JSON |
| `commit <run-id>` / `commit summary <run-id>` | commit is always JSON; summary is flag-gated with `formatCommitSummary` (line 299-307) | mixed |
| `report ...` | see handlers/operator.ts below (line 308-310) | mixed |
| `operator`, `graph`, `topology`, `summary` | handlers/operator.ts (lines 311-322) | mixed |
| `multi-agent` | handlers/multi-agent.ts (line 323-325) | mixed |
| `eval` | handlers/eval.ts (line 326-328) | flag |
| `blackboard`, `coordinator` | handlers/blackboard.ts (lines 329-334) | mixed |
| `sandbox`, `backend`, `contract`, `migration`, `feedback`, `metrics` | handlers/operational.ts (lines 335-352, 396-398) | mixed |
| `node` | handlers/node.ts (line 344-346) | always JSON except `graph` |
| `worker` | handlers/worker.ts (line 353-355) | mixed |
| `audit` | handlers/audit.ts (line 356-358) | mixed |
| `candidate` | handlers/candidate.ts (line 359-361) | mixed |
| `approve`, `reject`, `comment`, `handoff`, `review` | handlers/collaboration.ts (lines 364-378) | mixed |
| `ledger` | handlers/ledger.ts (line 379-381) | always JSON |
| `loop` | `printJson(scheduler.create({ ...options, kind: "loop" }))` (line 383-386) | always JSON |
| `schedule`, `routine`, `sched` | handlers/scheduling.ts (lines 387-392, 405-407) | always JSON |
| `registry`, `queue`, `history` | handlers/registry.ts (lines 393-395, 402-404, 417-419) | flag |
| `run` | handlers/run.ts (line 399-401) | mixed |
| `clones` | handlers/clones.ts (line 408-410) | flag |
| `gc`, `telemetry`, `demo` | handlers/maintenance.ts (lines 411-413, 420-425) | flag |
| `orphans` | handlers/orphans.ts (line 414-416) | flag |
| `workbench` | handlers/workbench.ts (line 426-428) | mixed |
| anything else | throws `Unknown command: <cmd>` with a "Did you mean" part when `suggestCommand` has a match (line 429-430) | — |

The runner is made with `pluginRoot: path.resolve(__dirname, "../..")`; `Scheduler` and `RoutineTriggerBridge` take `String(options.cwd || process.cwd())` (src/cli/command-surface.ts:95-99).

### Handler families (subcommands and exits)

**`report`** (src/cli/handlers/operator.ts:20-52): `report verify-bundle <path>` (also `--archive/--path/--file/--bundle`) prints JSON, exit 1 when `!ok`. `report bundle <run-id>` prints JSON, exit 1 when `!ok`. `report <run-id>`: `--json` = full report object; `--show`/`--summary` = `formatOperatorReport` + blank line + `formatStateExplosionReport`; default = only `report.path` + `\n`.

**`operator status|report <run-id>`** (operator.ts:55-72): flag-gated; `status` honors `--summary`/`--brief`.

**`graph <run-id>`** (operator.ts:75-79): flag-gated `formatOperatorGraph`.

**`topology list|show|validate|apply|summary|graph`** (operator.ts:82-116): `show <run-id> <topology-run-id>` when two positionals, else `show <topology-id>`; `validate` exits 1 when `!valid`; `summary`/`graph` are flag-gated.

**`summary refresh|show <run-id>`** (operator.ts:119-137): flag-gated `formatStateExplosionReport`.

**`multi-agent <verb> <run-id> [id]`** (src/cli/handlers/multi-agent.ts:16-147): verbs `status step blackboard score select summary summarize graph dependencies failures evidence reasoning run show role group membership fanout fanin`. `graph` with `--view`/`--focus`/`--depth` uses the view form (`formatCompactGraph`), else the operator graph. `reasoning --refresh` with no `--evidence` prints the refresh index. `run` has three shapes: host-run (no run-id or `--topology/--app/--workflow` given), show (`<run-id> <id>` and no `--id/--status`), transition (`<run-id> <id> --status ...`), else create. `role/group/membership/fanout/fanin` are show-when-bare-id, else create/assign/collect.

**`eval snapshot|replay|compare|score|gate|report`** (src/cli/handlers/eval.ts:15-44): shared tail prints JSON or `formatMultiAgentEval`. `gate` sets exit 1 when `status === "fail"` at TWO places — inside the case (only when not `--json`) and after the tail (always) — so `gate` fails closed in both modes.

**`blackboard`** (src/cli/handlers/blackboard.ts:15-72): `summary|summarize|graph|resolve|snapshot <run-id>`, `topic create <run-id>`, `message post|list <run-id>`, `context put <run-id>`, `artifact add|list <run-id>`. A verb with a wrong action word falls through to the usage throw. `summarize` is flag-gated with `formatBlackboardDigest`.

**`coordinator summary|decision <run-id>`** (blackboard.ts:75-87): always JSON.

**`sandbox list|show|validate|choose|resolve`** (src/cli/handlers/operational.ts:18-40): always JSON; `validate` exits 1 when `!valid`; `resolve` is one name with `choose`.

**`backend list|show|probe [id]` and `backend agent config [show|set]`** (operational.ts:43-68): always JSON; `config` with no `set` is the read path.

**`contract show <run-id> [contract-id]`** (operational.ts:71-80): always JSON.

**`migration list|check|prove [target]`** (operational.ts:83-104): `check` exits 1 on `status === "unsupported"`, `prove` exits 1 on `!proof.pass`.

**`feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]`** (operational.ts:107-134): `summary` is flag-gated with `formatFeedbackSummary`.

**`metrics show <run-id> | metrics summary`** (operational.ts:137-157): flag-gated with `formatMetricsReport` / `formatMetricsSummary`.

**`node list|show|graph|snapshot|diff|replay|verify`** (src/cli/handlers/node.ts:15-52): `diff` takes the 4th positional straight (`args.positionals[3]`, labels "baseline snapshot id" and "candidate snapshot id"); `verify` exits 1 when `!verdict.pass`; `graph` is the only flag-gated verb here.

**`worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]`** (src/cli/handlers/worker.ts:12-61): `fail` takes the message from `--message` or the 4th positional; `validate` prints the violation and exits 1 when it is non-null.

**`audit summary|verify|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [id]`** (src/cli/handlers/audit.ts:13-76): `verify` exits 1 when `!result.verified` (an absent chain verifies true → exit 0; a fully broken log verifies false → exit 1). The `multi-agent|policy|role|blackboard|judge` views are flag-gated with `formatMultiAgentTrustAudit`.

**`candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]`** (src/cli/handlers/candidate.ts:17-54): `reject` reason comes from `--reason`, `--message`, the 4th positional, or the string `rejected`; `summary` is flag-gated.

**Collaboration** (src/cli/handlers/collaboration.ts): `approve <kind> <run-id> <target-id>` and `reject <kind> <run-id> <target-id>` (kind label: `target kind (candidate|commit|selection|run|task|node)`); `comment add <kind> <run-id> <target-id> --body <text>` / `comment list <run-id>` (list flag-gated with `runner.formatCommentList`); `handoff <kind> <run-id> [target-id]` — when kind is `run` and no target id, the run id is the target (line 68); `review status <run-id>` (flag-gated) / `review policy <run-id> ...`.

**`ledger propose|review|verify|apply|list`** (src/cli/handlers/ledger.ts:27-133): all JSON.
- `propose --from A --to B --title T --rationale R [--files a,b] [--diff <patch>]` — the diff is passed byte-for-byte, never trimmed (line 38-43).
- `review --from A --to B --target ID --verdict approved|rejected [--findings a,b]` — verdict is upper-cased; other values throw `--verdict must be "approved" or "rejected".` (line 49-52).
- `verify [--file <path>]` — reads the file or stdin (fd 0). Bad JSON prints the fixed refusal object (see Exact outputs) and exits 1; a good parse prints `verifyLedgerEntry` and exits 1 when `!ok` (line 64-88).
- `apply [--file <path>]` — same read path; bad JSON prints its refusal object and exits 1; exits 1 when `!result.ok` so `cw ledger apply <file> | git apply` never feeds git an unverified patch (line 89-112).
- `list --dir <d> [--dir <d2> ...]` — two or more `--dir` values union-verify; exit 1 when `!allOk` in either shape (line 113-129).

**`schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon`** (src/cli/handlers/scheduling.ts:27-72): all JSON; `list --status S` filters; `daemon` builds `DesktopSchedulerDaemon` with `intervalSeconds` from `--intervalSeconds` or `--interval` (default 60); `daemon --once` prints one `tick()` and returns, else it runs on.

**`routine create|list|delete|fire|events`** (scheduling.ts:75-104): `fire <kind> [payload-file]` parses the JSON file, or uses the options as payload; a parse error throws `Failed to parse payload file "<path>": <msg>`.

**`sched plan|lease|release|complete|reclaim|reset|policy [show|set]`** (scheduling.ts:107-141): all JSON; `release`/`complete` take the lease id from `--leaseId` or the positional; `reset` id likewise.

**`registry refresh|show [--scope repo|home]`** (src/cli/handlers/registry.ts:22-41), **`queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]`** (registry.ts:44-66), **`history`** (registry.ts:69-74): flag-gated with `formatRegistryReport` / `formatQueueList` / `formatHistory`.

**`run`** (src/cli/handlers/run.ts:22-151): two surfaces under one verb.
- `cw run <app> --drive [--once] [--preview]`: when `--drive` is set AND the first positional is NOT in the registry-keyword set `{drive, search, list, show, resume, archive, rerun, export, import, verify-import, inspect-archive, restore}`, it drives. The run id may come from `--run`/`--runId`. `--preview` prints `runDrivePreview`. After a drive, when not `--json`, `emitRunSummary` writes the stderr summary (line 32-58).
- `run drive <run-id>` = read-only preview; with `--step [--once]` it becomes a mutating drive step plus the same summary (line 63-85).
- Registry verbs: `search`, `list` (both flag-gated with `formatRunSearch`), `show` (flag-gated `formatRunShow`), `resume` (flag-gated `formatResume`), `archive`, `rerun`, `export`, `import` (archive from positional or `--archive`/`--path`), `verify-import` (exit 1 ONLY with `--strict` and `!ok`), `inspect-archive` (exit 1 when `!ok`), `restore` (exit 1 when `!ok`) (line 86-147).

**`clones list|gc`** (src/cli/handlers/clones.ts:13-31): flag-gated; `gc [--older-than-days N] [--all]`. No runner needed.

**`gc plan|run|verify [run-id]`** (src/cli/handlers/maintenance.ts:18-54): flag-gated; `verify` exits 1 ONLY when `result.reclaimed && !result.verified` — a run never reclaimed is not a failure. Known limit noted in code: a deleted `reclaimed.json` reads as not-reclaimed (line 41-48).

**`telemetry verify [run-id] [--pubkey ...]`** (maintenance.ts:57-73): flag-gated; exit 1 when `!verified`; an absent ledger is `present:false/verified:true` → exit 0.

**`demo tamper|bundle [--json]`** (maintenance.ts:76-100): flag-gated; each exits 1 when `!proven`.

**`orphans list|gc [--scope repo|home] [--min-age-minutes N] [--all]`** (src/cli/handlers/orphans.ts:17-39): flag-gated; `--scope` default is `home`.

**`workbench serve [--port N] [--once] | view <run-id>`** (src/cli/handlers/workbench.ts:15-44): `view` is flag-gated with `formatWorkbenchView`; `serve --once` or `serve --json` prints the descriptor only (JSON with `surface:"workbench"`, `schemaVersion:1`); plain `serve` starts the localhost-only host (scope `repo` only when `--scope repo`, else `home`).

### Environment variables

| Var | Effect | Evidence |
| --- | --- | --- |
| `NO_COLOR` (non-empty) | no ANSI color anywhere, even on a TTY | src/term.ts:20 |
| `CW_NO_COLOR` (non-empty) | same as `NO_COLOR`; set by the `--no-color` flag | src/term.ts:20, src/cli/command-surface.ts:74 |
| `FORCE_COLOR` (set, not `""`, not `"0"`) | forces color on human output even when piped; the machine channels stay clean because they use no styling | src/term.ts:21, src/reporter.ts:8-11 |
| `CW_VERBOSE=1` | set by `--verbose`; full agent narration inline (read by the agent wrapper) | src/cli/command-surface.ts:73 |
| `CW_OUTPUT=full` | set by `--full`; stream full narration and print the report inline at run end | src/cli/command-surface.ts:75 |
| `CW_DRIVE_PROGRESS=0` | set by `--quiet`; suppresses drive progress lines (src/drive.ts's emitProgress) — does not touch the end-of-run summary or any other Rule of Silence gate point | src/cli/entry.ts |

Cross-subsystem vars the CLI tests lean on (owned elsewhere): `CW_AGENT_COMMAND`, `CW_AGENT_ENDPOINT`, `CW_NO_AUTO_AGENT`, `CW_DRIVE_PROGRESS`, `CW_HOME`, `XDG_STATE_HOME` (test/cli-recoverable-errors-smoke.js:26, test/cli-progress-summary-smoke.js:115, test/cli-handler-clones-smoke.js:19).

### Color rule (exact)

`colorEnabled(stream, env)` (src/term.ts:19-23):
1. If `NO_COLOR` or `CW_NO_COLOR` is a non-empty string → false.
2. Else if `FORCE_COLOR` is defined and not `""` and not `"0"` → true.
3. Else → `Boolean(stream.isTTY)`; the default stream is `process.stderr` (src/term.ts:12-14).

The ANSI codes used: reset `\x1b[0m`, bold `\x1b[1m`, dim `\x1b[2m`, green `\x1b[32m`, yellow `\x1b[33m`, red `\x1b[31m`, cyan `\x1b[36m` (src/term.ts:27-35). Help colors key off stdout (src/orchestrator.ts:933); error colors key off stderr (src/cli.ts:7-9).

## Exact outputs

### Version

```
0.1.98
```
(stdout, trailing `\n`; src/cli/command-surface.ts:49, src/version.ts:1)

### printJson shape

`JSON.stringify(value, null, 2)` plus one `\n`. Pinned example (test/cli-io-smoke.js:38):

```
{
  "a": 1,
  "b": [
    "x"
  ]
}
```

### Top-level error path (stderr, exit 1)

Any thrown error is caught in src/cli.ts:5-16 and written as:

```
cw: <error message>
  Try: <recovery command>
```

The `Try:` line only appears when `recoveryHint` matches (src/cli.ts:21-29): message starts with `unknown command` → `cw help`; has `not configured` or `agent backend` → `cw doctor`; has `missing` and `repo` → `cw -q "<question>" -dir <project-folder>`; has `app` and (`not found` or `not available`) → `cw app list`; has `run id` or `run not found` → `cw run list`; else no hint. On a color-off stream the bytes are plain; on color, `cw:` is bold, the message red, `Try:` dim.

Unknown command message (src/cli/command-surface.ts:430):

```
Unknown command: <cmd>. Did you mean: <suggestion>?
```

The `. Did you mean: ...?` tail is absent when `suggestCommand` finds nothing (distance must be `<= 3` AND `<= input.length/2`; inputs under 2 chars get nothing; src/orchestrator.ts:875-887).

### Missing-value error (io.required)

```
Missing <label>.
  Tip: find run ids with "cw run list" or create one with "cw quickstart"
```
(src/cli/io.ts:7)

### `formatHelp()` (stdout)

```
Cool Workflow

  -q "question" [-claude|-codex|-gemini|-deepseek]  Ask a question, get a report
  -q "question" --link <url>                 Review a remote repo by URL
  version                                   Show version
  update                                    Update to latest release
  doctor                                    Check setup
  fix                                       Show fix commands for setup issues

Flags
  -q, --question TEXT    The task or question to answer
  -r, --repo PATH        Target repository path (default: .)
  -d, --dir PATH         Project folder to review (alias for --repo)
  -claude                Use Claude agent
  -codex                 Use Codex agent
  -gemini                Use Gemini (via opencode)
  -deepseek              Use DeepSeek (via opencode)
  --verbose              Show full agent narration live (default: compact)
  --full                 Verbose, plus the report printed inline at the end
  --no-color             Disable ANSI color (also honors NO_COLOR / FORCE_COLOR)
  --json                 Print JSON for commands that support it
  --quiet                Suppress [drive] progress lines (not agent output)

More commands
<wrapped pipe-joined list>

    Run  cw help <command>  for one command's subcommands and descriptions.
```

The "More commands" list is this space-joined string, split and re-wrapped to lines of at most 76 columns, pipe-joined with a 2-space indent (src/orchestrator.ts:934-951):

```
list search info init plan status next dispatch result state commit report app sandbox backend contract node feedback worker audit candidate review loop schedule routine registry run queue clones orphans history quickstart audit-run multi-agent topology summary blackboard coordinator metrics operator sched gc telemetry migration demo workbench approve reject comment handoff ledger graph eval man version fix completion
```

The last note line uses a 4-space indent ON PURPOSE so the CLI/MCP parity help-token check (which only reads 2-space lines) never sees it as a command (src/orchestrator.ts:977-979). "Cool Workflow", "Flags", "More commands" are bold on a color stdout.

### `formatCommandHelp(verb)` (stdout)

Known verb: a bold `cw <verb>` line, a blank line, then one row per matching registry capability: 2 spaces + `cw <path...>` padded to the longest command width (top 40) + 2 spaces + summary, sorted by command (src/orchestrator.ts:998-1006). Unknown verb (still exit 0 through `cw help <verb>`):

```
Unknown command: <verb>
  Did you mean:  cw <hint>
  Try:  cw help   (list all commands)
```
(src/orchestrator.ts:991-996; the `Did you mean` line only with a match)

### `status` with no run id (human)

```
No run selected

Next Action
  cw plan <workflow-id> --repo <path>
    reason: No run id is available yet; create a workflow run before dispatching or recording evidence.
```
(src/cli/command-surface.ts:261; src/operator-ux.ts:222-230). Under `--json`: `{ "runId": null, "nextActions": [ { "command": ..., "reason": ..., "priority": "high" } ] }`.

### `search` with no match

```
No workflows matched "<keyword>".
  Tip: cw list for all available workflows.
```
With matches: bold `N workflow(s) matching "<kw>"` headline, then `  <id> — <title>` and an indented dim summary cut at 120 chars with `…`, then a blank line and dim `Use cw info <id> for full details.` (src/orchestrator.ts:889-897).

Missing keyword throws: `Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.` (src/cli/command-surface.ts:137). `man` with a bad topic throws: `Man page not found: <topic>.\n  Tip: cw list for workflow topics, or browse docs/ for manuals.` (src/cli/command-surface.ts:158).

### End-of-run summary (stderr, TTY only; reporter.runSummary)

Written only when stderr is a TTY (src/reporter.ts:53). Shape (src/reporter.ts:52-72):

```

Findings: 3 — 2×P1, 1×P2
  SEVERITY  CLASS        ID
  P1        real         F1
  P1        real         F2
  P2        conditional  F3

✓ Report: /path/report.md
  ✓ Status: complete — 2/2
  Transcript: /repo/.cw/runs/RUN1
  Next: cw report RUN1 --show
```

Non-complete run:

```
  ! Status: blocked — 0/14
  Try: cw doctor
```

The `Try: cw doctor` line appears when `agentConfigured === false`; otherwise `Next: cw status <run-id>` (src/reporter.ts:64-67). Findings block only when non-empty. Under `--full` the report body follows:

```

──── full report ────
<report text, trimmed>
```
(src/reporter.ts:69-71). The findings headline is `Findings: <n> — <count>×<sev>, ...` with severities ordered `P0 P1 P2 P3 none`; the column widths pad to at least 8 (`SEVERITY`) and 5 (`CLASS`); ids are cut at 60 columns with `…`; empty severity reads `none`, empty class `unknown`, empty id `(unnamed)` (src/term.ts:173-210).

### Phase progress lines (stderr; term.phaseProgressLine)

```
==> Map ✓ (6/6)
==> Assess ⇉ (3/6)
==> Verdict … (0/1)
```
Finished phase → green `✓`; running parallel phase → `⇉`; running sequential → `…`; the `(done/total)` part is absent when total is 0 (src/term.ts:104-109). `reporter.progress(line)` writes the given line + `\n` as-is on both TTY and non-TTY (src/reporter.ts:45-50).

### `printSuccessSummary` (stderr, TTY only; term.ts:116-143)

```

✓ Report: <reportPath>
  ✓ Status: complete — 14/14
  Next: cw report <runId> --show
```
or, not complete:
```
  ! Status: <status> — 0/14
  Try: cw doctor
```
(the `Try` line only when `agentConfigured === false`, else `Next: cw status <runId>`). Silent when the stream is not a TTY.

### `clones` human output (src/cli/format.ts:19-41)

Empty: `No cached remote checkouts in <clonesDir>.`
List:
```
<N> cached checkout(s) — <size> in <clonesDir>
  KIND       SIZE  FETCHED               SOURCE
  git      2.0KiB  2026-06-22 12:00:00Z  https://x/y@main

Reclaim with: cw clones gc --older-than-days 30   (or --all)
```
(kind padded to 7, size right-padded to 8, `fetchedAt` with `T`→space and the sub-second tail replaced by `Z`). Gc, nothing: `Nothing to reclaim (<scope>); <N> kept in <dir>.` — scope is `all entries` or `entries older than <N> day(s)`. Gc, work done: `Reclaimed <N> checkout(s) (<scope>) — freed <size>; <N> kept` plus one `  <size>  <url>` row each. `humanBytes`: `<1024` → `<n>B`, else 1 decimal in `KiB`/`MiB`/`GiB` (src/cli/format.ts:7-17; pinned in test/cli-format-smoke.js:12-17).

### `workbench view` human output (src/cli/format.ts:43-56)

```
Workbench view <runId> (resolved|UNRESOLVED)
  <group>:
    <name>: present — <capability>
    <name>: absent — absent (<error|unreadable>)
```

### `ledger verify` / `apply` bad-JSON refusal (stdout, exit 1)

verify (src/cli/handlers/ledger.ts:78):
```json
{ "ok": false, "id": null, "kind": null, "checks": [{ "name": "parse", "pass": false, "code": "ledger-bad-json" }], "failedChecks": [{ "name": "parse", "code": "ledger-bad-json" }] }
```
apply (ledger.ts:102):
```json
{ "ok": false, "id": null, "kind": null, "diff": null, "failedChecks": [{ "name": "parse", "code": "ledger-bad-json" }] }
```
(printed through `printJson`, so 2-space pretty in fact.)

### Usage strings (thrown; land on stderr as `cw: Usage: ...`)

```
Usage: cw app list|show|validate|init|package|run [app-id|path]
Usage: cw state check <run-id> [--state PATH] [--write]
Usage: cw audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]
Usage: cw blackboard summary|summarize|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>
Usage: cw coordinator summary <run-id> | coordinator decision <run-id> --kind <kind> --outcome <outcome> --reason TEXT
Usage: cw candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]
Usage: cw clones list [--json] | clones gc [--older-than-days N] [--all] [--json]
Usage: cw comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]
Usage: cw review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection
Usage: cw eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>
Usage: cw ledger propose|review|verify|apply|list [options]
Usage: cw gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]
Usage: cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]
Usage: cw demo tamper|bundle [--json]
Usage: cw multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]
Usage: cw node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]
Usage: cw sandbox list|show|validate|choose|resolve [profile-id|profile-file]
Usage: cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]
Usage: cw contract show <run-id> [contract-id]
Usage: cw migration list|check|prove [target] [--contract run-state|workflow-app]
Usage: cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]
Usage: cw metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--json]
Usage: cw operator status|report <run-id> [--json]
Usage: cw topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>
Usage: cw summary refresh|show <run-id> [--json]
Usage: cw orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)
Usage: cw registry refresh|show [--scope repo|home] [--json]
Usage: cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]
Usage: cw run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive|restore [run-id|archive] [--scope repo|home] [--json]  |  cw run <app> --drive [--once] [--incremental] [--repo R --question Q]
Usage: cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon
Usage: cw routine create|list|delete|fire|events
Usage: cw sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]
Usage: cw workbench serve [--port N] [--once] | view <run-id> [--json]
Usage: cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]
```

### `update` (stderr)

`Updating cool-workflow...\n`, then on a failed update `Update failed, trying install...\n`, then on a failed install `Install failed. Check npm and try again.\n` + exit 1 (src/cli/command-surface.ts:113-125). The npm children run with `stdio: "inherit"`.

### Exit codes

Exit 0 on success. `process.exitCode = 1` (not a hard `process.exit`) at every one of these points:

| Site | Condition | Evidence |
| --- | --- | --- |
| top-level catch | any thrown error | src/cli.ts:15 |
| `update` | both npm calls fail | command-surface.ts:121 |
| `fix` / `doctor` | `!report.ok` | command-surface.ts:129, 175 |
| `app validate` | `!result.valid` | command-surface.ts:196 |
| `quickstart`/`audit-run` | `mode==="check" && ok===false`; or `bundle.ok===false` | command-surface.ts:240-248 |
| `state check` | `status === "unsupported"` | command-surface.ts:292 |
| `audit verify` | `!verified` | handlers/audit.ts:28 |
| `eval gate` | `status === "fail"` (two sites) | handlers/eval.ts:33, 43 |
| `node verify` | `!verdict.pass` | handlers/node.ts:46 |
| `sandbox validate` | `!valid` | handlers/operational.ts:30 |
| `migration check` | `status === "unsupported"` | handlers/operational.ts:92 |
| `migration prove` | `!proof.pass` | handlers/operational.ts:98 |
| `topology validate` | `!valid` | handlers/operator.ts:95 |
| `report verify-bundle` | `!ok` | handlers/operator.ts:30 |
| `report bundle` | `!ok` | handlers/operator.ts:39 |
| `run verify-import` | `--strict` AND `!ok` | handlers/run.ts:128 |
| `run inspect-archive` | `!ok` | handlers/run.ts:136 |
| `run restore` | `!ok` | handlers/run.ts:145 |
| `worker validate` | violation non-null | handlers/worker.ts:55 |
| `gc verify` | `reclaimed && !verified` | handlers/maintenance.ts:48 |
| `telemetry verify` | `!verified` | handlers/maintenance.ts:67 |
| `demo tamper` / `demo bundle` | `!proven` | handlers/maintenance.ts:85, 94 |
| `ledger verify` | bad JSON, or `!ok` | handlers/ledger.ts:79, 86 |
| `ledger apply` | bad JSON, or `!ok` | handlers/ledger.ts:103, 110 |
| `ledger list` | `!allOk` (single or union) | handlers/ledger.ts:120, 127 |

## Files on disk

The CLI surface itself reads and writes little; state files belong to other parts. What it touches directly:

- `docs/<topic>.7.md` / `docs/<topic>.md` / `docs/<topic>` — read by `cw man <topic>`; raw bytes to stdout (command-surface.ts:150-159).
- `<reportPath>` — read under `--full` to print the report inline (src/cli/run-summary.ts:36-38).
- `<repo>/.cw/runs/<run-id>/` — the run dir; the summary derives it as `path.dirname(statePath)` and the repo base as three levels up; per-worker `transcript.md` files live there (src/cli/run-summary.ts:31-32; docs pointer in the `Transcript:` line).
- `--file <path>` or stdin (fd 0) — the ledger entry read by `ledger verify|apply` (handlers/ledger.ts:69, 94).
- `<payload-file>` — JSON read by `routine fire <kind> <file>` (handlers/scheduling.ts:91).
- `process.env` — presentation flags become `CW_VERBOSE`, `CW_NO_COLOR`, `CW_OUTPUT` for the child agent wrapper (command-surface.ts:73-75).

## Invariants and error behavior

- **stdout is data; stderr is chrome.** `printJson` output carries zero ANSI under any color env, `FORCE_COLOR` included, because machine paths use no styling at all (src/reporter.ts:8-11; pinned by test/cli-render-smoke.js:103-115). The end-of-run summary goes to stderr and only when stderr is a TTY (src/reporter.ts:53), and is fully off under `--json` (command-surface.ts:229; handlers/run.ts:47).
- **Fail closed.** Every verify/validate/gate verb reports through the exit code, not only through text (the table above). A no-agent drive blocks (`status:"blocked"`, `agentConfigured:false`) with a copy-ready `hint` naming `CW_AGENT_COMMAND` / `--agent-command`; it never makes up a run (pinned by test/cli-recoverable-errors-smoke.js:51-85).
- **Errors give a next move.** The top-level catch adds one `Try:` line when the message matches; no hint is given over a wrong one (src/cli.ts:18-29).
- **`--json` and `--format json` are the same switch** (src/cli/io.ts:22-24). Verbs are one of three JSON modes, declared per capability in the registry (`default`, `flag`, `human`) and the CLI must obey them (pinned by test/cli-jsonmode-parity-smoke.js).
- **One data source for CLI and MCP.** The dispatch `case "..."` tokens across `dist/cli.js`, `dist/cli/command-surface.js`, and `dist/cli/handlers/*.js` must line up with the capability registry and the MCP tool list (test/cli-mcp-parity-smoke.js:38-56; docs/cli-mcp-parity.7.md).
- **A flag never eats another flag.** The value of a bare `--flag` is `true` when the next token starts with `-` (src/orchestrator.ts:828-835; test/cli-arg-parsing-smoke.js).
- **`run <keyword> --drive` is not hijacked.** A registry keyword with a `--drive` flag falls through to the registry switch (handlers/run.ts:32-35).
- **Blackboard sub-verbs must `break`, not return**, on a wrong action word, so the tail usage throw still fires (handlers/blackboard.ts:1-7, 38-69).
- **`cw help <bad>` exits 0; `cw <bad>` exits 1.** The first prints the unknown-command help text on stdout; the second throws.
- **`explicit --repo` wins over `-dir`/`--dir`/`-d`** (command-surface.ts:65).
- The error path never writes to stdout — the recoverable-errors test asserts stdout has no chrome even on failure (test/cli-recoverable-errors-smoke.js:37).

## Edge cases

- `cw -q "text"` makes the question a consumed positional; if `--question` was ALSO given, the positional is kept and becomes the quickstart `appId` (command-surface.ts:88-90).
- `quickstart` on a TTY with no question asks `Question: ` on stderr and takes one line; a blank answer leaves `question` unset (command-surface.ts:435-445).
- `handoff run <run-id>` with no target id uses the run id as the target (handlers/collaboration.ts:68).
- `candidate reject` with nothing given uses the literal reason `rejected` (handlers/candidate.ts:43).
- `node diff` needs FOUR positionals; the fourth is read straight from `args.positionals[3]` (handlers/node.ts:31-38).
- `ledger propose --diff` is passed with its bytes unchanged — a trimmed diff would be a broken patch for `git apply` (handlers/ledger.ts:38-43).
- `ledger verify`/`apply` with no `--file` read stdin (fd 0); a read error throws `Cannot read ledger entry from stdin: <msg>` (handlers/ledger.ts:69-71, 94-96).
- `ledger list` with 2+ `--dir` values unions; with one it keeps the single-directory output shape (handlers/ledger.ts:113-128).
- `telemetry verify` with no run id does NOT trip `required` — an absent ledger verifies true, exit 0 (handlers/maintenance.ts:61-67; test/cli-handler-maintenance-smoke.js:48-49).
- `gc verify` on a never-reclaimed run exits 0 (`reclaimed:false` is not a failure) (handlers/maintenance.ts:41-48).
- `run verify-import` keeps exit 0 by default; only `--strict` turns failures into exit 1 (handlers/run.ts:123-129).
- `multi-agent run` shape detection: no run-id or a `--topology/--app/--workflow` option → host run; `<run-id> <id>` bare → show; with `--status` → transition; else create (handlers/multi-agent.ts:89-105).
- `suggestCommand` gives nothing for inputs under 2 chars or when the best distance is over 3 or over half the input length (src/orchestrator.ts:875-887).
- `KNOWN_COMMANDS` does NOT hold `ledger`, though the dispatcher handles it and `formatHelp` lists it — so a `ledger` typo may get a wrong or no suggestion (src/orchestrator.ts:842-851 vs 936-939).
- Repeated flags become arrays; `ledger list --dir a --dir b` depends on this (src/orchestrator.ts:1009-1016).
- `schedule daemon` default tick is 60 seconds; `--once` prints one tick as JSON and returns (handlers/scheduling.ts:57-68).
- `man` writes the raw file with NO added trailing newline (command-surface.ts:159).
- `truncate` edge shapes: width 0 → `""`, width 1 → `…`, else cut at `maxWidth-1` + `…`; ANSI is ignored for width (src/term.ts:162-168; test/cli-render-smoke.js:51-54).

## Evidence

Every claim above carries its pointer inline. Key anchors: src/cli.ts:5-29; src/cli/command-surface.ts:43-445; src/cli/io.ts:6-24; src/cli/format.ts:7-56; src/cli/run-summary.ts:16-50; src/cli/handlers/audit.ts:13-76; src/cli/handlers/blackboard.ts:15-87; src/cli/handlers/candidate.ts:17-54; src/cli/handlers/clones.ts:13-31; src/cli/handlers/collaboration.ts:14-88; src/cli/handlers/eval.ts:15-44; src/cli/handlers/ledger.ts:27-133; src/cli/handlers/maintenance.ts:18-100; src/cli/handlers/multi-agent.ts:16-147; src/cli/handlers/node.ts:15-52; src/cli/handlers/operational.ts:18-157; src/cli/handlers/operator.ts:20-137; src/cli/handlers/orphans.ts:17-39; src/cli/handlers/registry.ts:22-74; src/cli/handlers/run.ts:22-151; src/cli/handlers/scheduling.ts:27-141; src/cli/handlers/workbench.ts:15-44; src/cli/handlers/worker.ts:12-61; src/orchestrator.ts:789-1016; src/term.ts:12-210; src/reporter.ts:42-85; src/operator-ux.ts:222-230; src/version.ts:1; package.json:4-7.

## Pinned by tests

- `test/cli-arg-parsing-smoke.js` — flag-never-eats-flag, `--key=-value`, `--` end-of-options, short aliases `-d/-r/-q`.
- `test/cli-command-surface-smoke.js` — `src/cli.ts` stays a thin entry (≤80 lines, no switch); handler carve-outs stay delegated.
- `test/cli-io-smoke.js` — `required`/`optionalArg`/`wantsJson`/`printJson` byte shapes.
- `test/cli-format-smoke.js` — `humanBytes`, clones list/gc, workbench view text.
- `test/cli-recoverable-errors-smoke.js` — typo → `Did you mean` + `Try: cw help`; no-agent quickstart/drive block closed with `agentConfigured:false` and a copy-ready hint; missing-repo error points at `-dir`; nothing leaks to stdout on error.
- `test/cli-jsonmode-parity-smoke.js` — every probed verb obeys its registry `cli.jsonMode` (`flag` vs `default`).
- `test/cli-mcp-parity-smoke.js` — CLI dispatch tokens ↔ capability registry ↔ MCP tool list; `--json` payloads equal MCP payloads.
- `test/cli-render-smoke.js` — color env matrix (NO_COLOR/CW_NO_COLOR/FORCE_COLOR), `--json` byte-exact under `FORCE_COLOR`, findings table, reporter TTY/non-TTY, `--full` inline report, blocked-run `cw doctor` hint, truncate.
- `test/cli-progress-summary-smoke.js` — `printSuccessSummary` shapes, `phaseProgressLine` exact strings, `==>` progress on stderr with clean `--json` stdout.
- `test/cli-handler-clones-smoke.js`, `test/cli-handler-eval-node-smoke.js`, `test/cli-handler-maintenance-smoke.js`, `test/cli-handler-workbench-smoke.js` — dispatcher→handler routing, usage strings, `required` wiring, `workbench serve --once` descriptor, `demo bundle --json` proven.

## Rebuild risks

1. **The flag-value rule.** A value is taken only when the next token does not start with `-` (either dash). Getting this wrong re-opens the `--drive -dir` bug the tests pin (src/orchestrator.ts:828-835).
2. **Exit-code sites.** 25+ separate fail-closed exits with different conditions (`--strict` only, `reclaimed && !verified`, two sites in `eval gate`, absent-vs-corrupt in `audit verify`/`telemetry verify`). Merging or "cleaning up" any one changes behavior.
3. **Channel split.** Human chrome on stderr, TTY-gated; data on stdout, never styled, byte-exact under `FORCE_COLOR`; the summary fully off under `--json`. Any styled write to stdout breaks the parity and render tests.
4. **JSON-mode per verb.** Which verbs are always-JSON, flag-gated, or human-only is registry-declared and test-enforced; hand-copying it wrongly for even one verb trips `cli-jsonmode-parity-smoke`.
5. **Exact strings.** Usage lines say `cw ...` (every family, including `ledger`); the help text, `Try:`/`Next:` lines, `Missing <label>.` tip, and clones/findings tables are byte-pinned by tests and by the parity help-token parser (2-space rule).
6. **The `run` verb's two faces.** The `--drive` intercept must NOT fire when the first positional is a registry keyword; and `run drive <id>` is a preview unless `--step`.
7. **Shorthand and precedence.** `-dir` works because unknown single-dash names keep their name; `--repo` beats `dir`; `-q` as the COMMAND consumes its positional; vendor flags rewrite `agent-command`.
8. **Ledger byte fidelity.** The proposal `--diff` must pass through untrimmed, and bad-JSON input must yield the exact refusal objects with exit 1, not a crash.

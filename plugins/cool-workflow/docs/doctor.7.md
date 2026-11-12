# DOCTOR(7)

## NAME

`cw doctor` — check the setup and name all problems with their fixes

## SYNOPSIS

```text
node dist/cli.js doctor
node dist/cli.js doctor --json
node dist/cli.js doctor --fix
node dist/cli.js doctor --onramp
node dist/cli.js doctor --conformance
node dist/cli.js doctor --onramp --changed-from origin/main
```

## DESCRIPTION

`cw doctor` is a read-only check of your CW setup, based on `brew doctor`. It
probes your machine and says what is wrong and what to do about it — before a
run fails with a strange error.

The command never makes any file; it only reads. Running it changes nothing on
disk.

It gives back a report with one line for every check. Each check has a status
(`ok`, `warn`, or `fail`) and a clear note. Checks that are not `ok` carry a
`fix` line with the right command or step to put things right.

If any check has status `fail`, the command exits with code 1 (non-zero). A
`warn` (for example, no agent yet — demos and previews still work) does not
make the exit fail.

## CHECKS

The command runs these checks in order:

**node**
: The Node.js version. CW needs v22.13 or higher. A `fail` here stops everything.
When it is `ok`, the detail is `Node <version> (>= 22.13).`; when it is
`fail`, it is `Node <version> is below the required v22.13.` Up to 0.3.1 these
said `(>= 18)` and `v18` (changed in 0.3.2 with the operator's dated yes of
2026-10-17).

**agent**
: The AI agent backend. CW can auto-detect agents (Claude, Codex, Gemini,
OpenCode, Muse) or take one from `CW_AGENT_COMMAND` / `--agent-command`. The
builtins `copilot`, `antigravity` (both beta) and `grok` are never auto-detected; pick
them with `-copilot`, `-antigravity` or `-grok` (agent-delegation-drive(7)). Without one,
real runs report `status: blocked`, but `demo` and `--preview` still work.
The fix then says to install an agent CLI and add `-claude` (or set
`CW_AGENT_COMMAND=builtin:claude`); `-codex`, `-gemini` and `-opencode` work
too. (Before 0.4.0 it named a bare `--agent-command "claude -p"`, which does
not complete a worker; changed 2026-11-03, see agent-delegation-drive(7).)

**agent-binary**
: When the agent is set by a command name (not auto or HTTP), this check sees if
the binary is on `$PATH`. Missing here gives a `warn` — the run will get a clear
error later, but CW will not guess at a different agent.

**agent-runs** (new in 0.3.3)
: When an agent command is set (auto, `builtin:<name>`, `--agent-command`, or
`CW_AGENT_COMMAND`), doctor runs its vendor CLI one time with `--version`, to
see that it truly starts, not only that the file is there. The vendor CLI is
the one named for each builtin wrapper in `scripts/agents/builtin-templates.json`
(`versionProbe`), or the command itself when its first word is one of those
CLIs (for example `claude -p`). The run is argv-style (no shell), in the repo
folder, with the same env a real agent gets, and stops after 15 seconds
(`CW_DOCTOR_AGENT_PROBE_TIMEOUT_MS` makes this different). Doctor reads only
the exit code and the first lines of its output, and never prints env values.
- Exit 0: `ok`, with the first line it printed:
  `✓ agent-runs: claude --version → 2.1.302 (Claude Code)`.
- Exit non-zero, no start, or timeout: `fail` (doctor is then not ready and
  exits 1), with up to 4 of its own lines (300 characters at most), so its own
  fix hint is in view, and a `fix:` line. For example:
  `✗ agent-runs: claude --version exited 1: Error: claude native binary not installed. | ...`
- A custom command (a wrapper of your own, such as `$HOME/bin/review {{input}}`)
  is never run, as its arguments are not known and it may start real work, and
  it adds no `agent-runs` row: doctor's output is then what 0.3.2 printed. The
  same holds for a builtin with no CLI (`builtin:deepseek`, HTTP), for no agent,
  and for an HTTP endpoint only.

Up to 0.3.2 doctor did not run the agent, so an install whose CLI could not
start (for example, npm stopped its postinstall) still said `ready`. Changed
in 0.3.3 with the operator's dated yes of 2026-10-17. In `--json` it is one more entry in `checks`, in the same
shape as the others; the other checks do not change.

**agent-sandbox** (new in 0.3.3)
: Only while `CW_AGENT_SANDBOX` is set (see sandbox-profiles(7)). `ok` when
`srt` 0.0.81 is found (`CW_SRT_BIN` or `PATH`) and, on Linux, `bwrap` and
`socat` are on `PATH`; `fail` (doctor is then not ready) with how to install
what is missing, or for a value other than `srt`/`off`.

**sandbox-enforceability**
: A fixed fact, always `ok`: CW checks sandbox policy and gates what a worker
gives back; OS isolation is the work of the host (sandbox-profiles(7)). The
text view says it in one short line:
`✓ sandbox-enforceability: policy is checked by CW; OS isolation is the host's job (docs/sandbox-profiles.7.md).`
`--json` keeps the long `detail` text, byte for byte. Up to 0.4.2 the text
view printed the long text too, about 250 characters (changed in 0.4.3 with
the operator's dated yes).

**git**
: The `git` command. CW uses it for commit place of origin. A `warn` here means
commit roots will be recorded as absent; no other part of a run needs git.

**home-registry**
: The cross-repo run index at `$CW_HOME` (default `$HOME/.local/state/cool-workflow`).
This location must be writable. A `fail` here blocks discovery across repos.

**repo-state**
: The per-repo run store under `<cwd>/.cw`. Must be writable. A `warn` here
means runs stay in-memory only — you can use `--cwd PATH` to point at another
writable root.

## OPTIONS

`--json`
: Give back the full report as a stable JSON object. Good for scripts.

`--fix`
: Give back only the fix commands for every non-ok check. Same as running `cw fix`
by itself.

`--onramp`
: Add a quick-start guide to the human output, with recommended checks and a
three-step path to your first report. Since 0.4.3 the three steps put their
dash at one column (two more spaces in rows 1 and 2; the same yes as the
sandbox line above).
In a CW checkout, the checks it names are the `.mjs` test and script paths
(for example `test/doctor-smoke.mjs` and `test/onramp-check-smoke.mjs`). Up to
0.3.1 they ended in `.js` (changed in 0.3.2 with the operator's dated yes of
2026-10-17). Since 0.4.0 the guide also names `cw check -- npm
test`, the done receipt (see verifier-gated-commit(7), DONE RECEIPTS), with
the operator's dated yes of 2026-11-03.

`--conformance` (new in 0.3.3)
: Run the configured agent one time on a small fixed task, and check that it
keeps the agent contract, `cw-agent/1` (see agent-delegation-drive(7), "The
agent contract"). It goes the same way a real run goes (`runBackend`), in a
temp folder that is removed after, so it never writes `.cw/` or `$CW_HOME`.
It adds one check, `agent-conformance`:
- `ok` when the agent ends in time, exits 0, writes a `result.md` CW can
  read, and reports a model:
  `✓ agent-conformance: cw-agent/1: ran in 8.2s, exit 0, result.md read, model <model>.`
- `warn` when all of that holds but no model is reported (run records would say
  `unreported`), or when no agent is configured (nothing is run).
- `fail` (doctor is then not ready and exits 1) when it fails, times out,
  writes no `result.md`, or writes one CW cannot read. The detail gives the
  agent's own last lines of stderr, keys hidden.
This one runs a custom command too (the `agent-runs` check never does), so
it uses one short model call, which may cost money. That is why it is only
run when asked. The time limit is 180 seconds
(`CW_DOCTOR_CONFORMANCE_TIMEOUT_MS` makes it different).

`--changed-from <ref>`
: When used with `--onramp`, make the quick-start checks cover only files changed
since `<ref>` (a Git branch, tag, or commit). Good for CI and code reading.

## FILES

```text
src/shell/doctor.ts
src/shell/doctor-conformance.ts
src/shell/execution-backend/agent-sandbox.ts
dist/shell/doctor.js
```

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | All checks ok (may have warnings) |
| 1 | One or more checks have status `fail` |

## SEE ALSO

cw fix — the same checks, but gives back only the fix commands

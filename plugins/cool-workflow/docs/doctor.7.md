# DOCTOR(7)

## NAME

`cw doctor` — check the setup and name all problems with their fixes

## SYNOPSIS

```text
node dist/cli.js doctor
node dist/cli.js doctor --json
node dist/cli.js doctor --fix
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
`warn` (for example, no agent yet — `cw demo tamper` and `cw check` still work) does not
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
real runs report `status: blocked`, but `cw demo tamper` and `cw check` still work.
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

**git**
: The `git` command. CW uses it for commit place of origin. A `warn` here means
commit roots will be recorded as absent; no other part of a run needs git.

**repo-state**
: The per-repo run store under `<cwd>/.cw`. Must be writable. A `warn` here
means a run cannot save its state — run from a writable folder.

**run-state-integrity**
: Every run under `<cwd>/.cw/runs` must have a `state.json` that loads. A
`warn` names each run that does not (corrupt JSON, or an old run from before
batch 5, which CW refuses with one line) and says to remove that run folder.

Removed in batch 5 (2026-11-12): the `home-registry`, `agent-sandbox` and
`sandbox-enforceability` checks, with the run registry and the sandbox
profiles they checked.

## OPTIONS

`--json`
: Give back the full report as a stable JSON object. Good for scripts.

`--fix`
: Give back only the fix commands for every non-ok check. Same as running `cw fix`
by itself.

The `--onramp`, `--conformance` and `--changed-from` options were removed in
batch 5 (2026-11-12). `cw doctor` prints the three quick-start steps at the
end of the human report.

## FILES

```text
src/shell/doctor.ts
dist/shell/doctor.js
```

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | All checks ok (may have warnings) |
| 1 | One or more checks have status `fail` |

## SEE ALSO

cw fix — the same checks, but gives back only the fix commands

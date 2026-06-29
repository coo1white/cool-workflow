# DOCTOR(7)

## NAME

`cw doctor` — check the setup and name all problems with their fixes

## SYNOPSIS

```text
node dist/cli.js doctor
node dist/cli.js doctor --json
node dist/cli.js doctor --fix
node dist/cli.js doctor --onramp
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

The command runs six checks in order:

**node**
: The Node.js version. CW needs v18 or higher. A `fail` here stops everything.

**agent**
: The AI agent backend. CW can auto-detect agents (Claude, Codex, Gemini,
OpenCode) or take one from `CW_AGENT_COMMAND` / `--agent-command`. Without one,
real runs report `status: blocked`, but `demo` and `--preview` still work.

**agent-binary**
: When the agent is set by a command name (not auto or HTTP), this check sees if
the binary is on `$PATH`. Missing here gives a `warn` — the run will get a clear
error later, but CW will not guess at a different agent.

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
three-step path to your first report.

`--changed-from <ref>`
: When used with `--onramp`, make the quick-start checks cover only files changed
since `<ref>` (a Git branch, tag, or commit). Good for CI and code reading.

## FILES

```text
src/doctor.ts
dist/doctor.js
```

## EXIT CODES

| Exit | Meaning |
| --- | --- |
| 0 | All checks ok (may have warnings) |
| 1 | One or more checks have status `fail` |

## SEE ALSO

cw fix — the same checks, but gives back only the fix commands

# Multi-Vendor Agent Standards

CW is one kernel used by agents from more than one vendor — Claude, Codex,
Gemini, OpenCode, and others. A vendor agent meets CW in two ways: as a
CLIENT calling CW's CLI, and as a CONTRIBUTOR working with other vendor
agents to build CW itself. This page gives the rules for both. It adds no new
mechanism; it puts rules of use over mechanisms this project already has.

## Part 1 — Calling CW as a client (any vendor)

A vendor agent that calls CW as a client MUST:

1. Call only documented commands. The full command list is the CLI's command
   table (`src/wiring/commands.ts`), the same source `cw help` prints; see
   [the docs index](index.md#find-by-command).
2. Read `--json` output for anything it will act on. Text made for a person
   to read can change without notice; the JSON shape is the stable contract.
3. Check the exit code to know if a command worked — not the presence of any
   one word in stdout.
4. Never hand-edit a vendor's generated plugin file. Run `npm run
   gen:manifests` from the one manifest source.
5. Start any process with an argv-style spawn (`shell:false`), never a shell
   string — the same rule CW holds to when it starts an agent (see [Agent
   Delegation Drive](agent-delegation-drive.7.md)).
6. Treat CW's stable output as add-only. A later CW release may add a new
   optional field; do not depend on field order or on a field not in the
   documented schema.
7. Put a new vendor wrapper (if one is needed) under
   `plugins/cool-workflow/scripts/agents/`, next to the Claude/Codex/Gemini/
   OpenCode wrappers already there, and register it in
   `scripts/agents/builtin-templates.json`. Vendor-specific rendering stays in
   the wrapper; it never goes in the kernel (`src/`).

## Part 2 — Vendor agents working together to build CW

More than one agent, from more than one vendor, may work on this
repository at the same time — one on a run, one on a review, one on a
different feature branch. No agent may overwrite another agent's work
without a record, and every agent must leave a clear mark of what it did
and why.

1. **Say who you are.** When an action needs a record of who did it — a
   commit, a PR — name the agent with its real id, not a blank or made-up
   name.
2. **Never overwrite; always add a new record.** A decision, a review, or a
   note from one agent is an add-only record, not an edit to another
   agent's file or field.
3. **Hand off state through the run, not side chat.** Agents working the same
   run share state through that run's saved state under `.cw/runs/<id>/`
   (worker results, the report, the commit), read with `cw report`, not
   through files outside `.cw/`.
4. **One branch, one PR, one goal — the root `AGENTS.md` rules hold for
   every vendor.** No agent pushes to `main`. Give each PR one clear goal.
5. **A merge conflict between two agents' work is resolved the same way for
   every vendor** — see "Merge conflicts" in the root `AGENTS.md`. A conflict
   that touches the same logic, or signing, release, redaction or
   fail-closed code, goes to the human owner; do not guess.
6. **Mark your commits and PRs.** Name which agent (and, where it matters,
   which vendor) made a change, in the commit body or PR text.
7. **Read state before you act.** Before an action that could undo or get
   in the way of another agent's work still in progress (a commit, a
   release cut, a state write), read the current run/PR state first —
   `cw report <run-id> --show`, `gh pr view`.

## See also

- [Agent Delegation Drive](agent-delegation-drive.7.md)
- root `AGENTS.md` — the floor, how work moves, merge conflicts

# Multi-Vendor Agent Standards

CW is one kernel used by agents from more than one vendor — Claude, Codex,
Gemini, OpenCode, and others. A vendor agent meets CW in two ways: as a
CLIENT calling CW's CLI/MCP surface, and as a CONTRIBUTOR working with other
vendor agents to build CW itself. This page gives the rules for both. It adds
no new mechanism; it puts rules of use over mechanisms this project already
has: [Vendor Manifest Loadability](vendor-manifest-loadability.7.md),
[CLI <-> MCP Parity](cli-mcp-parity.7.md), [Team
Collaboration](team-collaboration.7.md), [Coordinator /
Blackboard](coordinator-blackboard.7.md), and [Cross-Agent
Ledger](cross-agent-ledger.7.md).

## Part 1 — Calling CW as a client (any vendor)

A vendor agent that calls CW as a client (CLI or MCP) MUST:

1. Call only documented commands. The full command list comes from one
   capability registry (`src/core/capability-data.ts`), the same source that
   makes both the CLI help and the MCP tool list — see [CLI <-> MCP
   Parity](cli-mcp-parity.7.md).
2. Read `--json` output (CLI) or the JSON-RPC result (MCP) for anything it
   will act on. Text made for a person to read can change without notice;
   the JSON shape is the stable contract.
3. Check the exit code (CLI) or the JSON-RPC error field (MCP) to know if a
   command worked — not the presence of any one word in stdout.
4. Never hand-edit a vendor's generated `mcp.json`. Run `npm run
   gen:manifests` from the one manifest source, and trust `npm run
   manifest:load-check` as the proof that a vendor's file will really start
   the server — see [Vendor Manifest
   Loadability](vendor-manifest-loadability.7.md).
5. Start any process with an argv-style spawn (`shell:false`), never a shell
   string — the same rule the execution backends hold to (see [Execution
   Backends](execution-backends.7.md)).
6. Treat CW's stable output as add-only. A later CW release may add a new
   optional field (POLA — see the FreeBSD Engineering Discipline section of
   the root `AGENTS.md`); do not depend on field order or on a field not in
   the documented schema.
7. Put a new vendor wrapper (if one is needed) under
   `plugins/cool-workflow/scripts/agents/`, next to the Claude/Codex/Gemini/
   OpenCode wrappers already there, and register it so `gen:manifests` and
   `manifest:load-check` cover it. Vendor-specific rendering stays in the
   wrapper; it never goes in the kernel (`src/`) — rule 2 of the FreeBSD
   Engineering Discipline in the root `AGENTS.md`.

## Part 2 — Vendor agents working together to build CW

More than one agent, from more than one vendor, may work on this
repository at the same time — one on a run, one on a review, one on a
different feature branch. This is like more than one person working on one
shared cloud document: no agent may overwrite another agent's work without a
record, and every agent must leave a clear mark of what it did and why.

1. **Say who you are.** When an action needs a record of who did it — an
   approval, a rejection, a comment, a handoff — give an attested actor id
   (`--attested`), not a blank or made-up name. See [Team
   Collaboration](team-collaboration.7.md) for the full `Actor` model
   (host-attested, operator-recorded, or unattributed — never faked).
2. **Never overwrite; always add a new record.** A decision, a review, or a
   note from one agent is an add-only record, not an edit to another
   agent's file or field. Team Collaboration's `approve`/`reject`/
   `comment`/`handoff` commands are the built-in way to do this inside a
   run. A fix to a past record is a NEW record with `supersedes`, never a
   silent rewrite.
3. **Hand off state through the built-in channels, not side chat.**
   - Agents working the same run/topology share state through the
     [blackboard](coordinator-blackboard.7.md) (topics, messages,
     artifacts), not through files outside `.cw/`.
   - Agents scoped to two different repositories hand each other a
     proposal or a verdict through [`cw
     ledger`](cross-agent-ledger.7.md) (`propose`/`review`/`verify`/
     `list`), a digest-sealed, fail-closed record — never an unverified
     side file.
4. **One branch, one PR, one goal — the root `AGENTS.md` rules hold for
   every vendor.** No agent pushes to `main` (the HARD RULE). Give each PR
   one clear goal (the Iteration Loop's SELECT step). Group related changes
   into one PR in place of a stack of small fix-PRs from more than one
   agent working against each other.
5. **A merge conflict between two agents' work is resolved the same way for
   every vendor** — see "Resolving merge conflicts" in the root
   `AGENTS.md`. A conflict that touches the same function/logic, or
   security-sensitive code, is a stop sign: put it in front of the human
   owner, do not guess.
6. **Mark your commits and PRs.** Name which agent (and, where it matters,
   which vendor) made a change, in the commit body or PR text, so the
   record stays clear once more than one agent has touched a branch's
   history.
7. **Read state before you act.** Before an action that could undo or get
   in the way of another agent's work still in progress (a commit, a
   release cut, a state write), read the current run/PR state first —
   `cw status`, `cw review status`, `gh pr view` — the same "read before
   you act" habit already asked of one agent alone, now held to across
   agents too.

## See also

- [Vendor Manifest Loadability](vendor-manifest-loadability.7.md)
- [CLI <-> MCP Parity](cli-mcp-parity.7.md)
- [Multi-Agent CLI + MCP Surface](multi-agent-cli-mcp-surface.7.md)
- [Team Collaboration](team-collaboration.7.md)
- [Coordinator / Blackboard](coordinator-blackboard.7.md)
- [Cross-Agent Ledger](cross-agent-ledger.7.md)
- root `AGENTS.md` — HARD RULE, Iteration Loop, Resolving merge conflicts

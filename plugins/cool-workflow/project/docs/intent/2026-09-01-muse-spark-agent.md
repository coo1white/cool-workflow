# Intent: support the muse CLI (spark model) as a delegated agent

Author: the operator (project owner). Status: accepted 2026-09-01.
Spec: [2026-09-01-muse-spark-agent.spec.md](2026-09-01-muse-spark-agent.spec.md)

## Problem

The operator uses Muse Code (`muse`, a terminal coding agent with a
headless `muse exec` mode) with its `spark` model. CW cannot delegate
work to it: there is no `builtin:muse` wrapper, no `-muse` flag, and
no auto-detect entry — so a muse user cannot get CW's saved, cited,
verified runs.

## Proposed outcome

`cw ... -muse` (and `--agent-command builtin:muse`) delegates worker
runs to `muse exec` with the `spark` model by default, with the same
saved records, provenance, and fail-closed behavior as the other five
vendors. After it ships, the operator cuts a release.

## Affected users and systems

Muse users; the agent wrapper set (`scripts/agents/`), builtin
template registry, CLI flags, agent auto-detect, doctor, and the
docs that name the supported agent CLIs.

## Constraints

Same as the standing program constraints: zero runtime dependencies,
no network code in CW itself (the wrapper spawns the vendor CLI
out-of-process, as all wrappers do), no model calls by CW, Basic
English, size budgets, all gates green. The release step itself stays
with the operator (the signing key never leaves them).

## Open questions

None — the muse CLI's headless interface was probed live before this
intent was accepted (see the spec's interface record).

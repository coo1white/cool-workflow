# Intent: close CW's AI-native SDLC gaps

Author: the operator (project owner). Status: accepted 2026-09-01.
Spec: [2026-09-01-sdlc-gap-closure.spec.md](2026-09-01-sdlc-gap-closure.spec.md)

## Problem

A deep read of CW against the AI-native SDLC playbook
(claude.com/blog/the-ai-native-sdlc-playbook) found that CW does the
playbook's per-stage artifact chain well INSIDE a run, but is cut off
from the SDLC's real spine outside it: run records never name the PR
they served; the app-code layer runs with full host power and the
record does not say so; and CW has no maintain-stage arc that turns a
metric breach into a queued, reviewable work item.

## Proposed outcome

1. A run can carry links to the PR/issue it served, shown in its
   report (shipped as `run link`, PR #584).
2. A breached control band can become an intent artifact and a queue
   entry, with the detection kept fully deterministic (`bands`).
3. The run record says plainly when workflow app code ran with full
   host power, in the same voice as the enforced/attested labels.
4. Growth of code, comments, and .md files is budget-controlled.

## Affected users and systems

Operators who audit runs; agents that call CW over MCP; the report,
run-registry, queue, and trust-audit subsystems; the repo's own gates.

## Constraints

Zero runtime dependencies. No network calls from the control plane.
No model calls. Basic English in all committed prose. Man pages are
the contract. All work ships branch -> PR -> green CI -> merge. Size
budgets per workstream; open-ended growth is a defect.

## Open questions

Whether the three schedulers should converge on "CW evaluates, the
platform triggers" (parked in BACKLOG.md, needs a North Star case).
Whether app code should later run in a contained child process
(parked; this intent only makes the record honest).

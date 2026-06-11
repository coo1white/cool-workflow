# Dogfood: architecture-review --drive on cool-workflow (CW v0.1.77)

Maintainer-run live proof (OUT of CI): a real external agent drove the whole
architecture-review workflow end-to-end with zero hand-written result.md. The
model ran in the agent's process; CW spawned it and recorded the attested
output. CW holds no API key and imports no model SDK.

- Date: 2026-06-11
- Run: architecture-review-20260611T014521Z-gfdd5v
- Status: complete
- Workers driven: 14/14 (zero hand-written result.md)
- Agent-reported model(s): claude-opus-4-8[1m] — sourced solely from the agent's own report, never CW_AGENT_MODEL
- Agent-reported usage: 14/14 workers reported tokens (38069 in / 168789 out)
- agent-delegation audit events: 14
- Commit: state-20260611T022527Z-c0mj4v
- Agent template: scripts/agents/claude-p-agent.js (read-only claude; the wrapper persists result.md and forwards model+usage)

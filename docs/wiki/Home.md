# Cool Workflow Wiki

**Get a saved, cited report from your AI agent — not a chat message you lose.**

Cool Workflow (CW) is an auditable workflow control-plane for AI coding agents. Point it at a repo or
a folder of docs and it plans the work, delegates each task to *your* agent, records and verifies every
result, and writes a report where every claim is cited to a `file:line` — all as durable `.cw/` state
on your own disk.

CW never runs the model itself. **The model is fuel; CW is the black-box recorder.** Your agent spends
the tokens; CW keeps the books.

## New here? Start with these

| Page | Use it for |
| --- | --- |
| **[Getting Started](Getting-Started.md)** | Install, run the 30-second tamper proof, and produce your first cited report. |
| **[Mental Model](Mental-Model.md)** | *Why* CW is built the way it is — the four commitments, and when it's worth it. |
| **[Glossary](Glossary.md)** | Every core term in one place: run, evidence, topology, verifier gate, and more. |
| **[Quickstart](Quickstart.md)** | The fast command reference once you know the shape. |

## Go deeper

| Page | Use it for |
| --- | --- |
| [Workflow Apps](Workflow-Apps.md) | Choose between the shipped apps and inspect app contracts. |
| [Architecture](Architecture.md) | The runtime boundary, state files, verifier gate, and MCP surface. |
| [Trust And Audit](Trust-And-Audit.md) | What telemetry, audit verification, and the trust limits actually prove. |
| [Recovery And Restore](Recovery-And-Restore.md) | Resume, export, inspect, import, verify, and rerun durable runs. |
| [Commands or API](Commands-or-API.md) | The stable CLI shapes and MCP entry points. |
| [MCP And Manifests](MCP-And-Manifests.md) | Generated vendor manifests and CLI ↔ MCP parity. |
| [Operations](Operations.md) | Verify, restore, regenerate manifests, and run release checks. |
| [FAQ](FAQ.md) | Trust limits, agent setup, reports, and failure behavior. |

## What CW does

- plans workflow apps into phases and tasks,
- dispatches isolated workers,
- **delegates each worker to an external agent** — it embeds no model SDK and holds no credentials,
- accepts and **verifies** `result.md` envelopes,
- records audit and telemetry ledgers (tamper-evident, ed25519),
- commits only verified state, and
- generates a cited report from the durable run record.

When evidence, dependencies, or rationale are missing, CW does not invent success — it stops at a
visible `unexplained` / `blocked` state. See the **[Mental Model](Mental-Model.md)** for why.

---

*This Wiki summarizes current repository evidence rather than introducing new public claims. The root
README remains the official first-run page.*

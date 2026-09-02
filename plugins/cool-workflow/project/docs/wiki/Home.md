# Cool Workflow Wiki

**Get a saved report from your AI agent, with every claim tied to a line of code — not a chat message you lose.**

Cool Workflow (CW) is a command-line tool that sits between you and your AI
coding agent. Point it at a repo or a folder of docs. CW plans the work, hands
each task to *your* agent, records and checks every result, and writes a
report where every claim points to a place in the code, like `file.ts:42`.
Everything is saved as plain files under `.cw/` on your own disk.

CW never runs the model itself. **The model is fuel; CW is the black-box
recorder.** Your agent spends the tokens; CW keeps the books.

## New here? Start with these

| Page | Use it for |
| --- | --- |
| **[Getting Started](Getting-Started.md)** | Install, run the 30-second tamper proof, and make your first report. |
| **[User Guide](User-Guide.md)** | Your first ten minutes, from a real test: what to type, what you see, what to do when a run stops. |
| **[Mental Model](Mental-Model.md)** | *Why* CW is built this way — the four commitments, and when it is worth it. |
| **[Glossary](Glossary.md)** | Every core term in one place: run, evidence, topology, verifier gate, and more. |
| **[Quickstart](Quickstart.md)** | The fast command reference, once you know the shape. |

## Go deeper

Read these in order for the full picture, or jump to the one you need:

| Page | Use it for |
| --- | --- |
| [Architecture](Architecture.md) | The runtime boundary, state files, verifier gate, and MCP surface. |
| [Repo Map](Repo-Map.md) | What every top-level folder and file is for, one line each. |
| [Workflow Apps](Workflow-Apps.md) | Pick between the shipped apps and see how an app is put together. |
| [Commands or API](Commands-or-API.md) | The stable CLI shapes and MCP entry points. |
| [MCP And Manifests](MCP-And-Manifests.md) | Generated vendor manifests and CLI ↔ MCP parity. |
| [Trust And Audit](Trust-And-Audit.md) | What the trust checks prove — and what they do not. |
| [Recovery And Restore](Recovery-And-Restore.md) | Resume, export, inspect, import, verify, and rerun saved runs. |
| [Operations](Operations.md) | Verify, restore, regenerate manifests, and run release checks. |
| [FAQ](FAQ.md) | Trust limits, agent setup, reports, and what happens when things fail. |

## What CW does

- plans a workflow app into phases and tasks,
- sends out workers, each in its own separate space,
- **hands each worker to an outside agent** — CW has no model SDK inside it
  and holds no keys,
- takes in each worker's `result.md` and **checks it**,
- keeps audit and telemetry ledgers — records that make any later edit
  visible, signed with ed25519,
- commits only checked state, and
- writes a report from the saved run record, with every claim tied to its
  source.

These lanes and the commands in the User Guide are the core path; the rest is kept working, not grown.

When evidence, dependencies, or a stated reason are missing, CW does not make
up success — it stops at a clear `unexplained` / `blocked` state. See the
**[Mental Model](Mental-Model.md)** for why.

---

*This Wiki sums up what is in the repository today; it makes no new claims.
The root README is still the official first-run page.*

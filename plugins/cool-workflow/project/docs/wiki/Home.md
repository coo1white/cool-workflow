# Cool Workflow Wiki

**Cool Workflow (CW) is a small command-line tool that gives your AI coding
agent a job, checks what it gives back, and writes a report where every claim
points to a line of code.**
**CW never runs the model itself: your agent does the work and spends the
tokens; CW keeps the books, as plain files under `.cw/` on your own disk.**

**New here? Go to the [Quickstart](Quickstart.md)** — one command shows CW at
work in 30 seconds, with no agent and no key:

```bash
npx cool-workflow demo tamper
```

This wiki is true to the released **0.3.3**. CW needs Node.js 22.13 or newer.

## Start here

| Page | Use it for |
| --- | --- |
| **[Quickstart](Quickstart.md)** | The shortest way in: the demo, a first review, and a resume. |
| **[Getting Started](Getting-Started.md)** | The same steps, slowly, with what each one does. |
| **[User Guide](User-Guide.md)** | Your first ten minutes, from a real test: what to type, what you see, what to do when a run stops. |
| **[Mental Model](Mental-Model.md)** | *Why* CW is made this way — the four commitments, and when it is worth it. |
| **[Glossary](Glossary.md)** | Every core word in one place: run, evidence, verifier gate, and more. |
| **[FAQ](FAQ.md)** | Trust limits, agent setup, reports, and what happens when things fail. |

## Use it

| Page | Use it for |
| --- | --- |
| [Workflow Apps](Workflow-Apps.md) | Pick one of the shipped apps, or make your own with `cw init`. |
| [Commands or API](Commands-or-API.md) | The command forms you will use most, and their MCP tools. |
| [Recovery And Restore](Recovery-And-Restore.md) | Resume, export, check, import, and replay saved runs. |
| [Run Registry Control Plane](Run-Registry-Control-Plane.md) | Find, queue, put away, and rerun runs across many repos. |
| [Trust And Audit](Trust-And-Audit.md) | What the trust checks prove — and what they do not. |
| [MCP And Manifests](MCP-And-Manifests.md) | Use CW from your editor, and how the CLI and MCP stay in step. |
| [Operations](Operations.md) | Agent settings, proxies, sandboxes, metrics, and release checks. |

## How it is made

| Page | Use it for |
| --- | --- |
| [Architecture](Architecture.md) | The runtime line, the state files, the verifier gate, and the backends. |
| [Architecture Principles](Architecture-Principles.md) | The rules CW is built on, and why. |
| [Repo Map](Repo-Map.md) | What every top-level folder and file is for, one line each. |
| [Roadmap](Roadmap.md) | Where CW is now, what is next, and what was taken out. |
| [Origin Story](Origin-Story.md) | How CW started, and why agents need a base system. |
| [Side Story](Side-Story.md) | How agents audit CW: one frame, five lenses. |

## What CW does

- plans a workflow app into phases and tasks,
- sends out workers, each in its own separate space,
- **gives each worker to an outside agent** — CW has no model SDK inside it
  and holds no keys,
- takes in each worker's `result.md` and **checks it**,
- keeps audit and telemetry ledgers — records that make any later change
  seen, signed with ed25519,
- commits only checked state, and
- writes a report from the saved run record, with every claim tied to its
  source.

When evidence, an agent, or a needed file is missing, CW does not make up
success — it stops at a clear `blocked` or `parked` state that you can look
into and resume. See the **[Mental Model](Mental-Model.md)** for why.

---

*This wiki sums up what is in the repository today; it makes no new claims.
The root README is still the official first-run page. An old page name that
is no longer in the sidebar still opens: it says where its text went.*

# Origin Story

*How Cool Workflow started, and the idea under it: agents need a small base
system, not one more framework.*

## Where it started

Cool Workflow started from a simple observation:

```text
Claude has workflows.
Codex has tools.
Cool Workflow gives Codex a workflow kernel.
```

Claude-style workflow habits made it clear that agent work should not be
only one turn of talk. Useful work needs phases, saved context, ordered
outputs, a way to go on later, and checks. Codex-style coding agents have
strong tools for doing things, but they need an open workflow layer that can
plan, split, record, check, resume, and deliver long engineering work.

So CW took the low-level habits, not a closed product:

| Workflow habit | How CW does it |
| --- | --- |
| a plan | a workflow app with phases |
| going on later | `.cw/runs/<run-id>/state.json` |
| giving out subtasks | dispatch manifests |
| keeping the outputs in order | task, result, and report files |
| review and checking | verifier gates |
| only good state is kept | the verifier-gated commit |
| work that goes on later | the run queue and resumable runs |
| working with any host | the CLI, MCP, and skills |

What CW keeps away from: being tied to one vendor, ideas that only hold on
one host, runtime logic hidden in a skill or an adapter, and taking one
prompt as the whole unit of work.

Today CW works the same with Claude, Codex, Gemini, OpenCode, and any agent
you give it as a command or an HTTP endpoint.

## The argument: agents need FreeBSD

*(This part is the short form of the essay "Agents Need FreeBSD, Not Another
Framework", which was its own wiki page before.)*

The agent world looks like Linux in 1998: many frameworks, each with its own
state format and its own idea of a "task", each a kernel, a package manager,
and a desktop in one block. Moving between them means writing everything
again. When a run goes wrong at 2 a.m., the answer to "what truly
happened?" is a long scroll through chat.

What is missing is not one more framework but a **base system**: small,
complete, all of a piece, and written down like a man page. An operating
system did not make programs smarter; it made them possible to see and to
govern. Agent work needs the same, more so, because agents do not give the
same answer twice and they act with real power. The questions an operator
has to answer are OS questions:

- What ran, when, and on whose say?
- What was it let touch, and was that limit put into force?
- What evidence is behind the result?
- What state was committed, and who checked it?

Why FreeBSD and not some other Unix? Four of its habits:

1. **The base system is one thing.** Kernel, tools, and docs are made and
   released together. In CW the run-state format, the rules, and the man
   pages change together, and a release is a checked snapshot of all of
   them.
2. **Jails.** A jailed process cannot see outside its walls. CW's sandbox
   profiles say what a worker may touch; from 0.3.3, CW can run each agent
   inside a real sandbox (`CW_AGENT_SANDBOX=srt`), where those limits are
   put into force, not only written down.
3. **Least surprise, and a fixed on-disk form.** Last year's run records
   must still load, check, and replay. CW treats its saved state like an
   ABI: version numbers, migrations, and a test for old state.
4. **Release engineering as a feature.** A release goes out when the gate
   passes — build, tests, a review by a second agent, a signed verdict —
   not on a date.

And, like FreeBSD's base with no X11 in it, CW keeps a written list of what
it will never do: call a model itself, manage prompts, keep the truth in a
hosted dashboard, or guess at success. The full list is in
[Architecture Principles](Architecture-Principles.md).

The short form fits on a card:

```text
Small kernel. Explicit state. Composable pipes.
Isolated workers. Verifier-gated commits. Docs as man pages.
```

## Related Pages

- [Mental Model](Mental-Model.md) — the four commitments, and when CW is
  worth it
- [Architecture Principles](Architecture-Principles.md)
- [Side Story](Side-Story.md) — how CW gets audited by agents

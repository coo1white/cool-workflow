<div align="center">

# Cool Workflow

**Point an AI coding agent at a repo, get a saved report with real citations — not a chat message you lose.**

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cool-workflow?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/cool-workflow)
[![downloads](https://img.shields.io/npm/dm/cool-workflow?style=flat-square&label=downloads)](https://www.npmjs.com/package/cool-workflow)
[![provenance](https://img.shields.io/badge/npm-provenance-3178C6?style=flat-square)](https://www.npmjs.com/package/cool-workflow)
[![release](https://img.shields.io/github/v/tag/coo1white/cool-workflow?style=flat-square&label=release&color=brightgreen&sort=semver)](https://github.com/coo1white/cool-workflow/tags)
[![license](https://img.shields.io/badge/license-BSD--2--Clause-blue?style=flat-square)](LICENSE)

<img src="docs/assets/cool-workflow-readme-promo.png" alt="Cool Workflow turns AI agent repo questions into saved, cited, tamper-evident reports." width="100%">

</div>

## What is this, really?

You put a question to an AI coding agent, it gives an answer in the chat, and
then the answer is gone. Next week you put the same question and have to start
all over again.

**Cool Workflow (CW) makes that lost question into a kept job.** You point it at
a code store with a question like *"what are the security risks here?"* It runs
your AI agent over all the code in ordered steps and puts a **report file** on
disk — every point backed by an exact `file.js:42` pointer to the line. You are
able to run it again, give it to others, and even give proof that the report was
not changed by anyone.

```
        you ask once                          CW gives you
   "what are the risks in my repo?"     →   a saved report.md with
                                              cited findings, repeatable
```

It does **not** run the AI model itself. You give your own agent (for one, the
`claude` command line) and CW keeps it working, makes a record of what took
place, and checks the answer. Take CW as the *project manager*, and your agent
as the *worker*.

> New to this? You're in the right place — this README is a step-by-step start.
> Deeper/advanced docs live in the [wiki](https://github.com/coo1white/cool-workflow/wiki).

---

## Project rule

CW should stay a small, trusted tool, not a platform.

```text
ask simple -> run simple -> verify simple -> resume simple
```

The engineering base is FreeBSD-like: POLA first, fail closed, no silent
fallback, stdout as data, stderr as diagnostics, and documented stable
surfaces. The user-facing spirit is close to Homebrew: a small command
surface, a strong `doctor` check, and clear next steps when a run is
blocked or a report does not verify.

That means CW should hide orchestration detail behind clear commands,
keep `.cw/` state open to check, make recovery boring, and prefer a
small tool that can be trusted over a broad agent platform.

---

## What you need

1. **Node.js** (v18+). Make a check with `node --version`.
2. **An AI agent on the command line.** The most simple is **Claude Code** —
   after you put it in you will have a `claude` command. Make a check with
   `claude --version`. (CW also works with `codex`, or any command/HTTP agent —
   but make your start with `claude`.)

> No agent yet? You are still able to **see CW work** (next part, step 1)
> without one. The full report needs an agent, because CW never makes a call to
> a model itself.

---

## Quick start (3 steps)

### 1. See it run — no install, no agent, no API key

```bash
npx cool-workflow demo tamper
```

This gives proof of CW's chief trick in 30 seconds (more on that
[below](#can-i-trust-the-report)). If you see `VERDICT: tamper-evidence holds ✓`,
all is working.

Not sure what to run next?

```bash
npx cool-workflow doctor --onramp
```

This prints the short path for a first run, the fast checks for source work, and
the full gate to use before a release.

From a source checkout, use:

```bash
cd plugins/cool-workflow
node scripts/cw.js doctor --onramp --changed-from origin/main
```

### 2. Check, then run a real review on your own repo

First make a zero-write check. It does not make a run, write `.cw/`, or call
your agent:

```bash
npx cool-workflow quickstart architecture-review --check \
  --repo /path/to/your/project \
  --question "What are the main risks in this codebase?" \
  --agent-command builtin:claude
```

If the check is good, run the review:

```bash
npx cool-workflow quickstart architecture-review \
  --repo /path/to/your/project \
  --question "What are the main risks in this codebase?" \
  --agent-command builtin:claude
```

- `--repo` — the folder you have a wish to get looked at.
- `--question` — what you have a wish to be certain of.
- `--agent-command builtin:claude` — make use of the Claude wrapper that comes
  with it (read-only; it never makes changes to your code).

CW makes a plan of the work, keeps `claude` working over your repo in steps, and
gives out where it kept the report. For a living view in the window while every
worker is at work, take it up with `CW_AGENT_STREAM=1`; the view goes to stderr
only and the kept answer is not changed.

> **No agent put in place?** CW comes to a safe stop and says so
> (`status: blocked`) — it never makes up an answer. Put in `claude` and run it
> again.

### 3. Read the report

```bash
cat /path/to/your/project/.cw/runs/<run-id>/report.md
```

You get a short account, ordered points, and **clickable pointers** like
`src/server.js:18` for every point made — so you are able to make a check of
each one yourself.

---

## Install it (optional)

`npx` is ever working with no need to put it in. To get the short `cw` command
everywhere:

```bash
npm install -g cool-workflow      # then use:  cw …   instead of  npx cool-workflow …
```

---

## What else can it do?

CW comes with a number of ready-made "jobs" (run `cw list` to see them all):

| Command | What it does |
|---|---|
| `architecture-review` | Make a map of a repo's structure and put its true risks in order, with facts. |
| `pr-review-fix-ci` | Go over a pull request, put forward fixes, make a check of CI. |
| `research-synthesis` | Get together and make into one a fact-backed answer to a question. |
| `release-cut` | Keep a gated, gone-over release moving. |

It also puts the same acts out over **MCP**, so editors like Claude Desktop /
Cursor / VS Code are able to make a call to CW as a tool. See the
[wiki](https://github.com/coo1white/cool-workflow/wiki) for that and for
multi-agent runs.

---

## Can I trust the report?

This is what makes CW not the same as the rest. Because CW only *gives the work
over* to your agent, it keeps a record of every step that makes any false change
come to light: every agent's given token use is signed by secret-key science and
chained by hash, so **changing the record after the fact has the chain broken** —
and anyone is able to make the check again offline with only a public key.

See it for yourself — the `demo tamper` from step 1 makes a false record in two
ways and gets both:

```text
▶ LEDGER tamper
  after:  ✗ DETECTED — the hash chain caught it: chain-link[2]: telemetry-chain-broken
▶ SIGNATURE tamper
  after:  ✗ DETECTED — signature does not match reported usage
VERDICT: tamper-evidence holds ✓ — every forgery caught offline, with only the public key.
```

On a true run, make a check of any run's record yourself:

```bash
cw telemetry verify <run-id>
```

CW makes use of this on its own code — see the kept living-run proof in
[`plugins/cool-workflow/docs/dogfood/`](plugins/cool-workflow/docs/dogfood/).

The plain point: *the thing that uses up the tokens is not the thing that keeps
the books.* That keeping-apart is normal in account-keeping — CW gives it to AI
agents.

---

## Hand the report to someone — they can check it on their own

A report you keep on your own machine is one thing. A report you can **give to
someone** who then makes the check themselves is what you are really after. Add
`--bundle` to the one command and CW seals the finished run into a single,
self-checking file:

```bash
npx cool-workflow quickstart architecture-review \
  --repo /path/to/your/project --question "What are the main risks?" \
  --agent-command builtin:claude --bundle --with-trust-key ./trust-pub.pem
```

This puts a `report.cwrun.json` file **where you are** (not in the looked-at
repo). The one file holds the report, the `file.js:42` pointers, the signed and
hash-chained record, **and the public key**.

Give that file to anyone. With no need for your repo, your keys given over on the
side, or a put-in past `npx`, they make the check on their own — offline, with
only the file:

```bash
npx cool-workflow report verify-bundle report.cwrun.json
```

If the bundle was changed in any way after the fact — the record, a signature, or
the bytes — the check says so and comes to a stop (it gives back `ok: false` and a
non-zero code), so a bundle you send on can never be a quiet lie. CW still never
runs the model itself; it only keeps the books and makes the check.

Want to see the whole thing in 30 seconds, with no agent and no key of your own?

```bash
npx cool-workflow demo bundle
```

It makes a real sealed bundle, makes two false changes to it, and shows the check
getting **both** — offline, with only the public key the bundle carries.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `status: blocked`, `agentConfigured: false` | No agent is in place. Put in `claude` (or give `--agent-command`). |
| `claude: command not found` | Put in Claude Code so the `claude` command is there, then run again. |
| Want to see the plan without running the AI | Put in `--preview` — it gives the steps and starts nothing. |
| Want a live agent trace | Put `CW_AGENT_STREAM=1`. It is stderr-only, TTY-gated, and `CW_NO_STREAM=1` puts it off. |
| Where did my report go? | The command gives out `reportPath`; it is under `<your-repo>/.cw/runs/<id>/report.md`. |

---

## How it works (one paragraph)

CW is a small TypeScript/Node run-time that needs no other parts. It makes a
record of the agent loop out in the open — *plan → dispatch → record → verify →
commit → report* — as long-lasting files on disk, so a run is open to looking-at
and able to be played again in place of a chat you let go. It never puts a model
SDK inside and keeps no API key; your put-in-place agent does the thinking, CW
does the book-keeping and the checking. For the structure, multi-agent
working-together, execution backends, and the full CLI/MCP face, see the
**[wiki](https://github.com/coo1white/cool-workflow/wiki)** and
[`plugins/cool-workflow/docs/`](plugins/cool-workflow/docs/).

---

## License

BSD-2-Clause. See [LICENSE](LICENSE). Built by COOLWHITE LLC.

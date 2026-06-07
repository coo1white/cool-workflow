# Cool Workflow

Cool Workflow, or CW, is an independent Agent Workflow SDK packaged as a
TypeScript runtime. It provides a COL-Architecture: Router / Orchestrator,
Subagent Dispatch, Deterministic Harness, Adversarial Verifier, Git/State
Commit, and MCP JSON-RPC 2.0 bridge.

The mental model is platform SDK plus developer apps: CW provides the runtime
and contracts, while developers write reusable workflow apps in
`workflows/*.workflow.js`.

CW records the model workflow loop explicitly:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

These loop stages are stored in `state.json`, task records, reports, and state
commit snapshots.

CW keeps orchestration state and task queues in files. An agent host executes
the tasks and feeds results back into the workflow.

CW follows a small set of Unix-inspired workflow principles: small kernel,
explicit state, composable pipes, isolated workers, and verifier-gated commits.
See [docs/unix-principles.md](docs/unix-principles.md).

CW v0.1.8 adds Sandbox Profiles: named worker policy contracts for read paths,
write paths, command execution, network access, and environment exposure. CW
stores and validates the policy, while the agent host enforces OS/process
runtime controls. See [docs/sandbox-profiles.7.md](docs/sandbox-profiles.7.md).

## Structure

```text
cool-workflow
  skills/cool-workflow/SKILL.md
  src/
  dist/
  scripts/cw.js
  workflows/architecture-review.workflow.js
  workflows/research-synthesis.workflow.js
  docs/agent-sdk.md
  docs/unix-principles.md
  docs/sandbox-profiles.7.md
  docs/candidate-scoring.7.md
  docs/verifier-gated-commit.7.md
```

## Commands

List bundled workflows:

```bash
node scripts/cw.js list
```

Create a reusable workflow script:

```bash
node scripts/cw.js init my-workflow --title "My Workflow"
```

Create a run:

```bash
node scripts/cw.js plan architecture-review \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --invariant "single-box self-hosted"
```

Create a dispatch manifest for the current runnable phase:

```bash
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js dispatch <run-id> --sandbox readonly
```

Inspect sandbox profiles:

```bash
node scripts/cw.js sandbox list
node scripts/cw.js sandbox show readonly
node scripts/cw.js sandbox validate ./site-sandbox.json
```

Record an agent result after a worker finishes:

```bash
node scripts/cw.js result <run-id> <task-id> path/to/result.md
```

Register, score, rank, and verifier-gate a candidate output:

```bash
node scripts/cw.js candidate register <run-id> --worker <worker-id>
node scripts/cw.js candidate score <run-id> <candidate-id> \
  --criterion correctness=4 \
  --criterion evidence=4 \
  --criterion fit=2 \
  --maxTotal 10 \
  --evidence /path/to/file.ts:42
node scripts/cw.js candidate rank <run-id>
node scripts/cw.js candidate select <run-id> <candidate-id> --reason "verified winner"
```

Create a deterministic state commit:

```bash
node scripts/cw.js commit <run-id> --verifier <node-id> --reason "verified result"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
node scripts/cw.js commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
```

The first two commands create verifier-gated committed state. The last command
creates an explicit non-gated checkpoint.

Render a report:

```bash
node scripts/cw.js report <run-id>
```

Run data lives under `.cw/runs/<run-id>/` in `--cwd`, or in `--repo` when
`--cwd` is omitted.

Build the TypeScript runtime:

```bash
npm install --no-package-lock
npm run build
```

See [docs/agent-sdk.md](docs/agent-sdk.md) for the developer contract.
See [docs/candidate-scoring.7.md](docs/candidate-scoring.7.md) for the
candidate scoring file contract.
See [docs/verifier-gated-commit.7.md](docs/verifier-gated-commit.7.md) for the
commit gate contract.
See [docs/sandbox-profiles.7.md](docs/sandbox-profiles.7.md) for the sandbox
profile contract.

## License

CW is released under the BSD-2-Clause License.

## Scheduled Tasks

```bash
node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule due
node scripts/cw.js schedule pause <schedule-id>
node scripts/cw.js schedule resume <schedule-id>
node scripts/cw.js schedule run-now <schedule-id>
node scripts/cw.js schedule history <schedule-id>
node scripts/cw.js schedule daemon --once
```

See [docs/scheduled-tasks.md](docs/scheduled-tasks.md).

## Routine-Style Triggers

```bash
node scripts/cw.js routine create --kind api --prompt "Handle this API event."
node scripts/cw.js routine create --kind github --prompt "Handle this GitHub event."
node scripts/cw.js routine fire api payload.json
node scripts/cw.js routine events
```

## Result Envelope

Verification and synthesis tasks require a structured result block:

````text
```cw:result
{
  "summary": "short summary",
  "findings": [
    {
      "id": "risk-1",
      "classification": "real",
      "severity": "P1",
      "evidence": ["/absolute/path/file.ts:42"]
    }
  ],
  "evidence": ["/absolute/path/file.ts:42"]
}
```
````

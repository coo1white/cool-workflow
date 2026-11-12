# Cool Workflow Docs

CW keeps the books for AI work: it records each claim with the lines it
rests on, verifies offline, and can resume a run. Start with the first run.

To find the page for one command, see [Find by command](#find-by-command).

## First Run

1. [Getting Started](getting-started.md) - install, run `cw doctor`, ask one question, read and check the report.
2. [Verifiable Report Bundle](report-verifiable-bundle.7.md) - make a portable report bundle and verify it offline.
3. [Trust Model & Limitations](trust-model.md) - what the ed25519 and hash-chain proof does and does not prove.

## How it works

- [Agent Delegation Drive](agent-delegation-drive.7.md) - plan, delegate, collect, evidence gate, commit, report.
- [Verifier-Gated Commit](verifier-gated-commit.7.md) - evidence checks that let a commit through or refuse it; `cw check` receipts.
- [Durable State & Locking](durable-state-and-locking.7.md) - atomic writes, fsync durability, and portable file locks.
- [Security / Trust Hardening](security-trust-hardening.7.md) - what CW refuses, and why.
- [Multi-Vendor Agent Standards](multi-vendor-agent-standards.7.md) - rules for any vendor agent that CW delegates to.
- [Unix Principles](unix-principles.md) - the design rules the CLI follows.

## Releases

- [Release And Migration](release-and-migration.7.md) - compatibility rules, and what each batch removed.
- [Release Tooling](release-tooling.7.md) - version bump and release gates.
- [Release History](release-history.md) - long capability notes moved out of the README.

## Find by command

| Command | What it does | Where it is documented |
|---|---|---|
| `cw -q "<question>"` | Asks one question about a repo and makes a cited report | [Agent Delegation Drive: CLI](agent-delegation-drive.7.md#cli) |
| `cw --resume --run <id>` | Finishes a run that stopped short | [Agent Delegation Drive: CLI](agent-delegation-drive.7.md#cli) |
| `cw report` | Writes and shows a run's report; makes and checks a bundle | [Verifiable Report Bundle](report-verifiable-bundle.7.md#commands) |
| `cw check` | Runs your test command and keeps a receipt a result can cite | [Verifier-Gated Commit: DONE RECEIPTS](verifier-gated-commit.7.md#done-receipts) |
| `cw demo tamper` | Proves the tamper checks with no agent | [Demo](demo.7.md#synopsis) |
| `cw doctor` | Checks your setup and gives a fix for each problem | [Doctor](doctor.7.md#synopsis) |
| `cw fix` | Prints the fix commands for setup problems | [Fix](fix.7.md#synopsis) |
| `cw version` | Prints the version | [Release And Migration](release-and-migration.7.md#removed-in-batch-5) |
| `cw help` | Prints the help page, or one command's sub-commands | `cw help <command>` |

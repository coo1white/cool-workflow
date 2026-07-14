# Security

Cool Workflow coordinates agent work and records workflow state. It does not
grant permissions beyond the normal approval, sandbox, MCP, and package controls
in the user's environment.

## Security Model

CW is a small control plane. It keeps commands, run state, evidence, and checks
in order. It is not an OS sandbox, an auth server, a model SDK, or a secret
store. The execution host has to put OS, process, network, and user approval
controls round CW.

### What Needs Protection

- `.cw/` run state, reports, evidence, and replay records
- agent input and result files
- trust keys and release signing keys
- the release gate, reviewer verdict, Git tag, and npm package
- the operator's files and process environment

### Input Which Is Not Trusted

- CLI and MCP arguments
- run archives and report bundles
- workflow app files outside the package roots
- agent, worker, and operator text kept in run state
- remote source URLs and remote execution results
- files under a run directory which may have been changed after they were made

### Trust Boundaries

- The MCP control process owns JSON-RPC work. The tool process owns file and
  process work. A tool result is data, not a new control message.
- `core` makes decisions. `shell` does file and process work. `wiring` joins
  CLI and MCP names to those mechanisms.
- A run archive is checked before restore work. Restore state is not trusted
  until file, telemetry, and trust-audit checks pass.
- An agent process is outside the CW kernel. The host gives it sandbox and
  approval controls. CW checks the result path and keeps an attestation of the
  controls the backend says it has.
- A remote endpoint is an operator choice. CW sends only the environment which
  the sandbox profile lets through and fails closed when the endpoint gives no
  checkable result.
- The release reviewer is separate from the release gate. The signing key stays
  with the operator and is not part of agent work.

### Work With More Power

These actions may write files, start a process, use a network, delete saved
state, or make a release. The host approval and sandbox settings are the first
control. CW then applies its own path, input, state, evidence, and release
checks. A failure has to stop before the protected change, or leave no success
record.

### What CW Does Not Promise

- A `readonly` CW profile does not by itself give OS read isolation.
- Local stdio MCP is not a network auth service.
- A hash proves that bytes did not change; it does not prove that the first
  writer told the truth.
- Text from an agent or an outside file may contain bad instructions. Treat it
  as data and keep approval controls on actions with side effects.

## Reporting Issues

Please open a GitHub security advisory or contact the repository owner for
vulnerabilities that could expose secrets, execute unintended commands, corrupt
workflow state, or bypass evidence gates.

## Safety Notes

- Review subagent dispatch manifests before running sensitive work.
- Do not place secrets in workflow prompts, state files, result Markdown, or
  `.cw/` run directories.
- Treat external workflow definitions and MCP endpoints as untrusted until you
  inspect them.
- Keep approvals and sandbox settings aligned with the repository you are
  working in.
- Use `cw run restore` for the checked move of a run. `cw run import` is the
  lower-level file mechanism.

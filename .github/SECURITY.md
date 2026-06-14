# Security

Cool Workflow coordinates agent work and records workflow state. It does not
grant permissions beyond the normal approval, sandbox, MCP, and package controls
in the user's environment.

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

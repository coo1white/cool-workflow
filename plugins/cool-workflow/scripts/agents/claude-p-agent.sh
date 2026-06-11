#!/usr/bin/env bash
# EXAMPLE operator agent config for CW Agent Delegation Drive — bash entry point.
#
# The single source of truth is claude-p-agent.js (the portable node version);
# this shim only delegates so the two can never drift. Point CW at either:
#   CW_AGENT_COMMAND="node $(pwd)/scripts/agents/claude-p-agent.js {{input}} {{result}}"
#   CW_AGENT_COMMAND="bash $(pwd)/scripts/agents/claude-p-agent.sh {{input}} {{result}}"
set -euo pipefail
exec node "$(dirname "$0")/claude-p-agent.js" "$@"

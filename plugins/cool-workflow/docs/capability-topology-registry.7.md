# CAPABILITY-TOPOLOGY-REGISTRY(7) — Cool Workflow Agent-Driven Self-Evolution

## Name

`capability-dispatcher`, `registerCapabilityHandler`, `registerTopology` — open registries for agent-driven CW extension

## Description

v0.1.53 introduces two open registries that let agents extend CW at runtime
without manual wiring in multiple files. New capabilities self-register and
auto-work across CLI, MCP, and Workbench. New topologies self-register and
auto-appear in `topology list`, `topology validate`, and `topology apply`.

BSD discipline: **mechanism** (Map / pipe) separate from **policy** (entries).
Fail-closed on unknown ids.

## Capability Registry

### Interface

```typescript
interface CapabilityHandler {
  descriptor: CapabilityDescriptor;
  run(args: Record<string, unknown>, ctx: CapabilityContext): unknown | Promise<unknown>;
}

interface CapabilityContext {
  runner: CoolWorkflowRunner;
  cwd: string;
}
```

### Registering a new capability

```typescript
import { registerCapabilityHandler } from "./capability-registry";

registerCapabilityHandler({
  descriptor: {
    capability: "my.new.tool",          // canonical dot-namespaced id
    summary: "Does something useful.",   // one-line description
    entry: "myNewTool",                  // core entry name
    surface: "both",                     // "both" | "cli-only" | "mcp-only"
    cli: { path: ["my", "new-tool"], jsonMode: "default" },
    mcp: { tool: "cw_my_new_tool" }
  },
  run: async (args, ctx) => {
    // ctx.runner exposes all orchestrator methods
    return ctx.runner.listWorkflows();
  }
});
```

### How it works

1. `registerCapabilityHandler()` stores the handler in a `Map<string, CapabilityHandler>`
2. CLI: `resolveCliPath(["my", "new-tool"])` resolves the CLI path to the capability id
3. MCP: `resolveMcpTool("cw_my_new_tool")` resolves the tool name to the capability id
4. `dispatchCapability(id, args, ctx)` invokes `handler.run(args, ctx)`
5. Both the CLI and MCP surfaces fall through to the dynamic dispatcher when
   their hardcoded switch statements don't match an unknown command/tool

### Existing capabilities

All existing 182 capabilities continue to work through their hardcoded switch
cases in `cli.ts` and `mcp-server.ts`. The dynamic dispatch is a **fallback**
— it only activates for commands/tools not found in the legacy switches.

## Topology Registry

### Interface

```typescript
interface MultiAgentTopologyDefinition {
  schemaVersion: 1;
  id: string;              // open string namespace (was closed union)
  title: string;
  summary: string;
  roles: TopologyRoleSpec[];
  groups: Array<{ id: string; title: string; roleIds: string[] }>;
  blackboardTopics: Array<{ id: string; title: string; description: string }>;
  phases: TopologyPhaseSpec[];
  fanoutStrategy: string;
  faninStrategy: string;
  requiredEvidence: string[];
  coordinatorDecisions: CoordinatorDecisionKind[];
  candidateExpectations: string[];
  verifierGates: string[];
}

interface TopologyRoleSpec {
  id: string;
  title: string;
  responsibilities: string[];
  count?: number;         // NEW: materialize N instances of this role
  requiredEvidence: string[];
  expectedArtifacts: string[];
  faninObligations: string[];
}
```

### Registering a new topology

```typescript
import { registerTopology } from "./topology";

registerTopology({
  schemaVersion: 1,
  id: "swarm",
  title: "Swarm",
  summary: "Parallel swarm agents with consensus voting.",
  roles: [
    { id: "swarm-agent", title: "Swarm Agent",
      responsibilities: ["Produce shard result with evidence."],
      requiredEvidence: ["swarm output artifact"],
      expectedArtifacts: ["swarm result"],
      faninObligations: ["indexed swarm artifact"],
      count: 5 }
  ],
  groups: [{ id: "swarm", title: "Swarm Group", roleIds: ["swarm-agent"] }],
  blackboardTopics: [
    { id: "swarm-outputs", title: "Swarm Outputs", description: "Agent results." }
  ],
  phases: [
    { id: "execute", title: "Execute", roleIds: ["swarm-agent"],
      fanout: true, fanin: false,
      requiredEvidence: ["swarm output artifact"],
      coordinatorDecisionKinds: ["artifact-index"] },
    { id: "consensus", title: "Consensus", roleIds: ["synthesizer"],
      fanout: false, fanin: true,
      requiredEvidence: ["all swarm evidence"],
      coordinatorDecisionKinds: ["candidate-synthesis"] }
  ],
  fanoutStrategy: "one membership per swarm agent role",
  faninStrategy: "consensus requires all swarm agent evidence",
  requiredEvidence: ["swarm output artifact", "consensus synthesis"],
  coordinatorDecisions: ["artifact-index", "candidate-synthesis"],
  candidateExpectations: ["Synthesis cites swarm agent provenance."],
  verifierGates: ["Swarm fanin must be ready before commit."]
});
```

### How it works

1. `registerTopology()` stores the definition in a `Map<string, MultiAgentTopologyDefinition>`
2. `listTopologyDefinitions()` returns official + registered, registered wins on id collision
3. `getTopologyDefinition(id)` checks registered first, then official
4. `materializedRoles()` uses `role.count` for replication — no more hardcoded
   mapper/judge switch logic
5. `applyTopology()` works identically for official and registered topologies

### Data-driven role expansion

Before v0.1.53, `materializedRoles()` hardcoded "mapper" and "judge" role
expansion. Now it checks `role.count` on each role spec:
- `role.count > 1`: creates `role-1`, `role-2`, ... `role-N`
- `role.count` undefined or 1: creates a single role instance
- For backward compat with official topologies, `mapperCount` and `judgeCount`
  input overrides still apply

## See Also

- `capability-registry.ts` — the single source of truth for all capabilities
- `capability-dispatcher.ts` — the thin Map-based dispatch pipe
- `topology.ts` — topology definitions and the registry
- `types/topology.ts` — topology type definitions
- `docs/cli-mcp-parity.7.md` — CLI <-> MCP parity gate
- `docs/multi-agent-topologies.7.md` — official topology recipes

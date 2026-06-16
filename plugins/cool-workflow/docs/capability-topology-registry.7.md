# CAPABILITY-TOPOLOGY-REGISTRY(7) — Cool Workflow Agent-Driven Self-Evolution

## Name

`capability-dispatcher`, `registerCapabilityHandler`, `registerTopology` — open registries for agent-driven CW extension

## Description

v0.1.53 adds two open registries. They let agents grow CW at runtime
with no need to wire things by hand in many files. New capabilities put
themselves in the registry and then work by themselves across CLI, MCP, and Workbench. New topologies put
themselves in the registry too and then come up by themselves in `topology list`, `topology validate`, and `topology apply`.

BSD way: keep **mechanism** (Map / pipe) apart from **policy** (entries).
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

1. `registerCapabilityHandler()` keeps the handler in a `Map<string, CapabilityHandler>`
2. CLI: `resolveCliPath(["my", "new-tool"])` turns the CLI path into the capability id
3. MCP: `resolveMcpTool("cw_my_new_tool")` turns the tool name into the capability id
4. `dispatchCapability(id, args, ctx)` calls `handler.run(args, ctx)`
5. Both the CLI and MCP surfaces drop through to the dynamic dispatcher when
   their hardcoded switch statements do not match an unknown command/tool

### Existing capabilities

All 182 capabilities that are there now keep working through their hardcoded switch
cases in `cli.ts` and `mcp-server.ts`. The dynamic dispatch is a **fallback**
— it turns on only for commands/tools not found in the old switches.

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
2. `listTopologyDefinitions()` gives back official + registered; registered wins when two ids are the same
3. `getTopologyDefinition(id)` looks at registered first, then official
4. `materializedRoles()` uses `role.count` to make copies — no more hardcoded
   mapper/judge switch logic
5. `applyTopology()` works the same way for official and registered topologies

### Data-driven role expansion

Before v0.1.53, `materializedRoles()` hardcoded the "mapper" and "judge" role
expansion. Now it reads `role.count` on each role spec:
- `role.count > 1`: makes `role-1`, `role-2`, ... `role-N`
- `role.count` undefined or 1: makes one role instance
- So that official topologies keep working as before, the `mapperCount` and `judgeCount`
  input overrides still hold

## See Also

- `capability-registry.ts` — the one true source for all capabilities
- `capability-dispatcher.ts` — the thin Map-based dispatch pipe
- `topology.ts` — topology definitions and the registry
- `types/topology.ts` — topology type definitions
- `docs/cli-mcp-parity.7.md` — CLI <-> MCP parity gate
- `docs/multi-agent-topologies.7.md` — official topology recipes

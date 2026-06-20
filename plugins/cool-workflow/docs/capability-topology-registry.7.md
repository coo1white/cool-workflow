# CAPABILITY-TOPOLOGY-REGISTRY(7) — Cool Workflow Agent-Driven Self-Evolution

## Name

`capability-registry`, `registerTopology` — the declared capability contract and the open topology registry for agent-driven CW extension

## Description

CW keeps two layers here. The **capability registry**
(`src/capability-registry.ts`) is the one declared source of truth for every
capability CW exposes; it is read at build/check time, not written to at
runtime. The **topology registry** (`src/topology.ts`) is an open runtime
registry: new topologies put themselves in it with `registerTopology()` and
then come up by themselves in `topology list`, `topology validate`, and
`topology apply`.

> History: v0.1.53 also shipped a dynamic *capability* dispatcher
> (`capability-dispatcher.ts`, `registerCapabilityHandler`,
> `dispatchCapability`, `resolveCliPath`, `resolveMcpTool`) meant to let
> capabilities register handlers and be routed at runtime. It had zero call
> sites — the handler map was always empty and every dispatch path was
> unreachable — so it was removed as dead code in v0.1.81 (#131). Capabilities
> are **declared**, not runtime-registered; see below. (The unrelated
> `cw dispatch` command, which writes a subagent dispatch manifest, is a normal
> declared capability, not that dispatcher.)

BSD way: keep **mechanism** (the registry / the open Map) apart from **policy**
(the entries). Fail-closed on unknown ids.

## Capability Registry

The capability registry, `src/capability-registry.ts`, is the SINGLE declared
source of truth for every capability CW exposes — and the contract both front
doors (CLI and MCP) are checked against. It is a static, read-only array of
descriptors, `CAPABILITY_REGISTRY`. There is no runtime "register a handler"
seam and no dynamic dispatcher: capabilities are data here, not code that wires
itself in.

### Descriptor

```typescript
interface CapabilityDescriptor {
  capability: string;   // canonical dot-namespaced id, e.g. "worker.list"
  summary: string;      // one-line description
  entry: string;        // the ONE shared core entry both surfaces route through
  surface: "both" | "cli-only" | "mcp-only";
  cli?: { path: string[]; jsonMode: "default" | "flag" | "human" };
  mcp?: { tool: string; requiredArgs?: string[] };
  payloadIdentical?: boolean;  // CLI --json === MCP result (default true for "both")
  reason?: string;             // required when surface !== "both" or payloadIdentical === false
}
```

### Adding a capability

A capability is declared once, as data, in `CAPABILITY_REGISTRY`, against one
shared core `entry`:

```typescript
{
  capability: "my.new.tool",
  summary: "Does something useful.",
  entry: "myNewTool",
  surface: "both",
  cli: { path: ["my", "new-tool"], jsonMode: "default" },
  mcp: { tool: "cw_my_new_tool" }
}
```

`cli.ts` and `mcp-server.ts` each route their surface to the shared `entry` with
their own explicit `switch` routing (plus a few `if (action === …)` branches).
The registry is what those switches are validated against, not something they
call into — there is no fallback dynamic dispatch.

### How it works

1. `CAPABILITY_REGISTRY` declares every capability once — one row per capability.
2. CLI: `cli.ts` matches the command in its explicit `switch` and calls the core `entry`.
3. MCP: `mcp-server.ts` matches the tool name in its explicit `switch` and calls the same `entry`.
4. The parity gate (`scripts/parity-check.js --check`) fails closed on any drift:
   a CLI command or MCP tool live on one surface but absent on the other or
   undeclared, an undeclared payload divergence, or a surface-specific capability
   with no recorded `reason`.

### How many capabilities

Run `node plugins/cool-workflow/scripts/parity-check.js --check` and read
`registrySize` for the live count (199 at the time of writing). The full
CLI <-> MCP matrix lives in `docs/cli-mcp-parity.7.md`, which is generated from
the same registry.

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

- `capability-registry.ts` — the one declared source for all capabilities
- `capability-core.ts` — the shared core entries both surfaces route through
- `topology.ts` — topology definitions and the registry
- `types/topology.ts` — topology type definitions
- `docs/cli-mcp-parity.7.md` — CLI <-> MCP parity gate
- `docs/multi-agent-topologies.7.md` — official topology recipes

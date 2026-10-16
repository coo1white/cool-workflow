# CAPABILITY-TOPOLOGY-REGISTRY(7) — Cool Workflow Agent-Driven Self-Evolution

## Name

`capability-registry` — the declared capability contract for agent-driven CW extension

## Description

The **capability registry** (`src/core/capability-data.ts`) is the one
declared source of truth for every capability CW exposes; it is read at
build/check time, not written to at runtime.

> History: this page also gave an account of the open **topology registry**
> (`registerTopology()`, behind `topology list|validate|apply`). It was taken
> out with the multi-agent family (slim-and-esm program, step 2); see
> release-and-migration(7), "Removed Surfaces". The page keeps its name so
> `cw man capability-topology-registry` still works.

> History: v0.1.53 also shipped a dynamic *capability* dispatcher
> (`capability-dispatcher`, `registerCapabilityHandler`,
> `dispatchCapability`, `resolveCliPath`, `resolveMcpTool`) meant to let
> capabilities register handlers and be routed at runtime. It had zero call
> sites — the handler map was always empty and every dispatch path was
> unreachable — so it was removed as dead code in v0.1.81 (#131). Capabilities
> are **declared**, not runtime-registered; see below. (The unrelated
> `cw dispatch` command, which writes a subagent dispatch manifest, is a normal
> declared capability, not that dispatcher.)

BSD way: keep **mechanism** (the registry) apart from **policy** (the
entries). Fail-closed on unknown ids.

## Capability Registry

The capability registry, `src/core/capability-data.ts`, is the SINGLE declared
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

## See Also

- `src/core/capability-data.ts` — the one declared source for all capabilities
- `src/wiring/capability-table/registry-core.ts` — the shared core entries both surfaces route through
- `docs/cli-mcp-parity.7.md` — CLI <-> MCP parity gate

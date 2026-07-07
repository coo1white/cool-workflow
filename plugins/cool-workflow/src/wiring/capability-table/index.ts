// wiring/capability-table/index.ts — composes the capability table from
// registry-core (the shared machinery) plus every domain slice, in the
// EXACT original source order (REGISTRY array order is a pinned
// behavior: tools/list order, gen-parity-doc's byte-diff gate, cw help
// line order). Each slice is a plain module whose top-level
// attachCliBinding/addCliOnlyCapability/REGISTRY_BY_CAPABILITY calls run
// once, at first import — Node's module system guarantees that happens
// in exactly the order these imports are written below, the same
// guarantee the single original file relied on for its own top-to-bottom
// statement order.
//
// No slice imports another slice; every slice imports only from
// registry-core.ts, core/capability-data.ts, and shell/core as needed —
// so this file is the only place the full domain list is assembled, and
// there is no cross-slice circular dependency to reason about.

export * from "./registry-core";

import "./basics";
import "./state";
import "./exec-backend";
import "./pipeline";
import "./trust-ledger";
import "./multi-agent";
import "./scheduling-registry";
import "./reporting";
import "./workflow-apps";

export * from "./parity";

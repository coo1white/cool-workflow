// shell/execution-backend/types.ts — re-export shim.
//
// The real declarations moved to core/types/execution-backend.ts (they are
// plain data, no logic — safe for core/ to own directly, and the
// executor-boundary welds in core/types/boundary.ts need two of them). This
// file stays so every existing `from "./types"` / `from "../execution-
// backend/types"` import site keeps working unchanged.
export type * from "../../core/types/execution-backend";

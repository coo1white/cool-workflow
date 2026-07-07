"use strict";
// core/types/observability.ts — the one type shell/observability.ts's
// executor-boundary weld (core/types/boundary.ts) needs, moved here since
// it is plain data with no dependency on that (impure) file's logic.
// shell/observability.ts re-exports it so its own existing exports stay
// unchanged.
Object.defineProperty(exports, "__esModule", { value: true });

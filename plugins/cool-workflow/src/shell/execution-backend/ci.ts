// shell/execution-backend/ci.ts — the ci delegating driver.
//
// MILESTONE 5 (docs/rebuild/PLAN.md build order, step 5). The ci driver shares its
// entire HTTP-delegation body with the remote driver (byte-exact port of
// plugins/cool-workflow/src/execution-backend.ts, which also shares
// `runHttpDelegation` between the two); this file just re-exports the ci
// handle builder + the shared delegation runner under the ci-specific name
// so the registry's driver table reads naturally (one module per driver id,
// per PLAN.md's target shape `container.ts, remote.ts, ci.ts`).

export { ciHandle, runHttpDelegation as runCiDelegation } from "./remote";

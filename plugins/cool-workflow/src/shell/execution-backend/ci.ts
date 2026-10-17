// shell/execution-backend/ci.ts — the ci delegating driver.
//
// The ci driver shares its entire HTTP-delegation body with the remote
// driver (`runHttpDelegation`); this file just re-exports the ci handle
// builder + the shared delegation runner under the ci-specific name so the
// registry's driver table reads naturally (one module per driver id).

export { ciHandle, runHttpDelegation as runCiDelegation } from "./remote.js";

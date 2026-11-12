// core/types/boundary.ts — the one-way executor boundary as a type.
//
// CW hands an agent a folder and gets plain data back: the agent's exit,
// stdout and the result envelope it wrote. Nothing callable crosses — no
// model client, no SDK handle, no callback. `OneWayData<T>` maps a type to
// itself only when it is plain data; any function type anywhere in it turns
// to `never`, so `AssertTrue<IsOneWayData<T>>` breaks the build. The welds
// sit next to the types they guard (AgentOutcome, AgentReport,
// ResultEnvelope); test/one-way-boundary-smoke.mjs proves a violating type
// does not compile and that the welds stay in source.
export {};

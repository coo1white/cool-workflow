// core/types/boundary.ts — the one-way executor boundary as a type.
//
// Nothing callable crosses to or from an agent. A function type anywhere
// in T makes `AssertTrue<IsOneWayData<T>>` (a "weld") break the build;
// test/one-way-boundary-smoke.mjs keeps the welds honest.
export {};

// core/types/boundary.ts — the one-way executor boundary as a type.
//
// Nothing callable crosses to or from an agent. A function type anywhere
// in T makes `AssertTrue<IsOneWayData<T>>` (a "weld") break the build;
// test/one-way-boundary-smoke.mjs keeps the welds honest.

export type OneWayData<T> = [unknown] extends [T]
  ? T // `unknown` (or `any`): opaque data — uninvokable without a cast
  : T extends (...args: never[]) => unknown
    ? never
    : T extends string | number | boolean | null | undefined
      ? T
      : T extends readonly (infer E)[]
        ? readonly OneWayData<E>[]
        : T extends object
          ? { [K in keyof T]: OneWayData<T[K]> }
          : never;

/** `true` iff T carries no callable anywhere. A union with a violating member
 *  collapses to `boolean`, which also fails the weld. */
export type IsOneWayData<T> = T extends OneWayData<T> ? true : false;

/** Only `true` satisfies the constraint. */
export type AssertTrue<T extends true> = T;

// core/util/collate.ts — THE one string-ordering comparator for anything
// whose order feeds a hash, a cache key, or a byte-pinned output.
//
// Pure. No fs, no child_process, no net, no process.env, no Date.now(), no
// Math.random().
//
// A bare `a.localeCompare(b)` reads the HOST's default locale (LANG/LC_ALL),
// which is not part of CW's replay-determinism story: two machines with
// different locales sorting the SAME string set can walk it in a different
// order, so anything that hashes that order (a cache key) drifts silently
// across hosts, and anything that hashes CONTENT built from that order (an
// eval snapshot) can misreport a determinism regression that is really just
// a locale difference. `stableCompare` pins the locale explicitly to "en" —
// this is the SAME bytes Node's full-ICU build already produces under the
// ICU root locale (which is what a locale-stripped environment, e.g. this
// repo's own conformance harness, always runs under), so switching a bare
// `localeCompare` call to this one changes NO existing output.
export function stableCompare(a: string, b: string): number {
  return a.localeCompare(b, "en");
}

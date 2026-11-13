// core/util/collate.ts — the one string order for anything hashed or pinned.
// A bare localeCompare reads the host's locale, so two machines could sort
// the same strings differently; this pins "en", which matches the ICU root
// order the conformance harness already gets.
export function stableCompare(a, b) {
    return a.localeCompare(b, "en");
}

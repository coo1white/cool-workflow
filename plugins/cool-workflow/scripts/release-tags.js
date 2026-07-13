"use strict";
// release-tags.js — the ONE semver-ordered release-tag lookup, shared by
// release-flow.js and release-gate.js so the two can never drift (the gate
// used to carry a bash port of this logic; a mirror copy is exactly the kind
// of thing that rots).
//
// "What was the last release" is a SEMVER question, not an ancestry question:
// a cut's own tag commit lives on an ephemeral line that is NEVER merged as
// an ancestor of `main` (cut() tags the verdict-record commit directly), so
// `git describe --tags --abbrev=0`, which walks ONLY ancestors, always skips
// the true previous release tag and silently lands one release further back
// (verified live: `git describe --tags v0.2.4^` -> v0.2.2, skipping v0.2.3).
// List every vX.Y.Z tag and pick by version order instead.

function parseSemverTag(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// gitOut: (args: string[]) => string — the caller's own git runner (each
// caller binds its own repo root), returning trimmed stdout, "" on failure.
function listReleaseTagsDesc(gitOut) {
  const out = gitOut(["tag", "-l", "v*"]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((tag) => ({ tag, semver: parseSemverTag(tag) }))
    .filter((t) => t.semver)
    .sort((a, b) => compareSemver(b.semver, a.semver));
}

// The most recent ALREADY-RELEASED tag as of right now: the highest vX.Y.Z
// tag that does NOT already point at HEAD — so this works whether run before
// tagging or re-run on a freshly tagged commit.
function resolvePrevReleaseTag(gitOut) {
  const headTags = new Set(gitOut(["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean));
  const found = listReleaseTagsDesc(gitOut).find((t) => !headTags.has(t.tag));
  return found ? found.tag : "";
}

module.exports = { parseSemverTag, compareSemver, listReleaseTagsDesc, resolvePrevReleaseTag };

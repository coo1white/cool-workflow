// release-tags.mjs — the ONE semver-ordered release-tag lookup, shared by
// release-flow.mjs and release-gate.mjs so the two can never drift (the gate
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

// The release just below `tag` by version order ("" when none). The GitHub
// Release notes start here (--notes-start-tag): with no start tag, GitHub
// picks the last ANCESTOR tag, which is v0.2.2 for every release since.
function releaseBefore(gitOut, tag) {
  const own = parseSemverTag(tag);
  if (!own) return null;
  const found = listReleaseTagsDesc(gitOut).find((t) => compareSemver(t.semver, own) < 0);
  return found ? found.tag : "";
}

export { parseSemverTag, compareSemver, listReleaseTagsDesc, resolvePrevReleaseTag, releaseBefore };

// CLI: `node scripts/release-tags.mjs previous vX.Y.Z` prints the release
// before it (empty when none), for .github/workflows/release.yml.
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "previous") {
  const { spawnSync } = await import("node:child_process");
  const gitOut = (args) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").trim() : "";
  };
  const prev = releaseBefore(gitOut, process.argv[3] || "");
  if (prev === null) {
    process.stderr.write("usage: release-tags.mjs previous vX.Y.Z\n");
    process.exit(1);
  }
  process.stdout.write(prev ? `${prev}\n` : "");
}

// release-notes.mjs — the "What changed" part of a GitHub Release body.
// Consumer: release-flow.mjs (releaseGitHub), tested by
// test/release-notes-smoke.mjs. Pure: no git, no network, no model call. The
// caller reads the log; this file only turns it into one short page.
//
// The operator's rule (BACKLOG 2026-09-03, yes on 2026-10-17 in
// project/docs/intent/2026-10-16-release-gate-ci.md): one page, simple. One
// line that says what the release is, at most six bullets (feat first, then
// fix) from the pull request titles since the last tag, one link to the User
// Guide, one link to the full compare. The long grouped list was turned down.

export const MAX_BULLETS = 6;
const KIND_RE = /^(feat|fix)(\([^)]*\))?!?:\s*(.+)$/i;

// The log text is `git log --first-parent --format=%s%x1f%b%x1e`. A merge
// commit's subject is "Merge pull request #N from ..." and its body's first
// line is the pull request title; any other commit's subject is the title.
export function titlesFromLog(raw) {
  const titles = [];
  for (const rec of String(raw || "").split("\x1e")) {
    const [subject = "", body = ""] = rec.split("\x1f");
    const s = subject.trim();
    if (!s) continue;
    const title = /^Merge pull request #\d+ from /.test(s) ? (body.trim().split(/\r?\n/)[0] || "").trim() : s;
    if (title) titles.push(title);
  }
  return titles;
}

// "fix(release): the npm check asks the registry (#803)" -> "the npm check asks
// the registry". Trailing "(...)" groups are taken off: they hold PR numbers
// and program step names, which say nothing to a user. The words are kept as
// the author wrote them (no capital is forced: "cw doctor" stays "cw doctor").
function plain(text) {
  let t = text.trim();
  while (/\s*\([^()]*\)$/.test(t)) t = t.replace(/\s*\([^()]*\)$/, "");
  return t.replace(/[.\s]+$/, "");
}

export function pickChanges(titles) {
  const feat = [], fix = [];
  for (const title of titles) {
    const m = KIND_RE.exec(title);
    if (!m) continue;
    const line = plain(m[3]);
    if (line) (m[1].toLowerCase() === "feat" ? feat : fix).push(line);
  }
  return { feat, fix };
}

export function renderWhatChanged({ version, prevTag, slug, titles }) {
  const { feat, fix } = pickChanges(titles);
  const all = [...feat, ...fix];
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const out = ["### What changed", ""];
  out.push(all.length
    ? `cool-workflow ${version}: ${count(feat.length, "new feature", "new features")} and ${count(fix.length, "fix", "fixes")} since ${prevTag}.`
    : `cool-workflow ${version}: no new features or fixes a user can see since ${prevTag}; this release is upkeep.`);
  if (all.length) out.push("", ...all.slice(0, MAX_BULLETS).map((l) => `- ${l}`));
  const base = slug ? `https://github.com/${slug.owner}/${slug.repo}` : "";
  if (base) {
    const more = all.length > MAX_BULLETS ? ` (${all.length - MAX_BULLETS} more there)` : "";
    out.push("", `New to CW? Start with the [User Guide](${base}/wiki/User-Guide).`);
    out.push(`Every change: [\`${prevTag}...v${version}\`](${base}/compare/${prevTag}...v${version})${more}.`);
  }
  return out.join("\n");
}

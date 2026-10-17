// release-ci-checks.mjs — read GitHub's check runs for ONE exact commit and
// say whether the checks branch protection requires on `main` are green.
// Consumers:
//   - scripts/release-gate.mjs      (--tests-from-ci: the gate's test step is
//                                   satisfied by these checks in place of a
//                                   local test:gate run)
//   - scripts/release-flow.mjs      (reads the gate's evidence file for the
//                                   reviewer input and the verdict commit)
//   - scripts/release-oneclick.mjs  (waits for the checks on the cut commit
//                                   before the cut stage)
//   - test/ci-shape-gate-smoke.mjs  (pins REQUIRED_CHECKS to the ci.yml
//                                   `check` matrix)
//   - test/release-gate-ci-checks-smoke.mjs
//
// REQUIRED_CHECKS is the ONE place the release tooling names the required
// checks. It must stay equal to main's branch protection (AGENTS.md: the
// ubuntu `check` legs on Node 22 and 24); ci-shape-gate-smoke fails when a
// name here is not a leg of ci.yml's `check` job.
//
// Fail closed: only a check run that is `completed` with conclusion
// `success`, made by the GitHub Actions app, for the exact sha, counts. A
// missing, queued, in-progress, failed, cancelled, skipped or timed-out run,
// a gh error, an origin that is not on github.com, or output that does not
// parse — each one is a "no", never a green.
//
// Zero dependencies: node + git + gh. Every spawn is argv-style, shell:false.

import { spawnSync } from "node:child_process";

const REQUIRED_CHECKS = Object.freeze(["check (22)", "check (24)"]);
const REQUIRED_APP = "github-actions";

/** owner/repo from a github.com remote URL, or null — the same match as
 *  release-flow.mjs repoSlug(). */
function repoSlugFromUrl(url) {
  const m = String(url || "").match(/github\.com[:/]+([^/]+?)\/(.+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Pure: judge a parsed check-runs API body for `sha`. Returns
 *  { ok, state, checks, problems } where state is "ok" | "pending" |
 *  "failure" | "missing", and checks has one row per required name. */
function evaluateCheckRuns(body, sha, required = REQUIRED_CHECKS) {
  const runs = body && Array.isArray(body.check_runs) ? body.check_runs : null;
  if (!runs) {
    return { ok: false, state: "missing", checks: [], problems: ["the check-runs reply has no check_runs list"] };
  }
  const checks = [];
  const problems = [];
  let pending = false;
  let failed = false;
  let missing = false;
  for (const name of required) {
    const mine = runs.filter((r) => r && r.name === name && r.head_sha === sha && r.app && r.app.slug === REQUIRED_APP);
    if (!mine.length) {
      missing = true;
      checks.push({ name, status: "missing", conclusion: null, url: null });
      problems.push(`${name}: no check run from ${REQUIRED_APP} on ${sha}`);
      continue;
    }
    // More than one run with the name (a re-run, a second event): every one
    // must be green, so a red copy is never hidden by a green one.
    const notDone = mine.find((r) => r.status !== "completed");
    const notGreen = mine.find((r) => r.status === "completed" && r.conclusion !== "success");
    const shown = notGreen || notDone || mine[0];
    checks.push({ name, status: shown.status, conclusion: shown.conclusion || null, url: shown.html_url || null });
    if (notGreen) {
      failed = true;
      problems.push(`${name}: completed with conclusion ${notGreen.conclusion || "(none)"}${notGreen.html_url ? ` — ${notGreen.html_url}` : ""}`);
    } else if (notDone) {
      pending = true;
      problems.push(`${name}: ${notDone.status} (not completed yet)${notDone.html_url ? ` — ${notDone.html_url}` : ""}`);
    }
  }
  const state = failed ? "failure" : missing ? "missing" : pending ? "pending" : "ok";
  return { ok: state === "ok", state, checks, problems };
}

/** The fix line for a state that is not ok. */
function fixFor(state) {
  const local = "or, only when CI cannot be reached, run the full suite here: --local-tests (or CW_RELEASE_LOCAL_TESTS=1)";
  if (state === "pending") return `wait for CI to finish on this commit, then re-run; ${local}`;
  if (state === "failure") return `fix the red check in a normal PR (a release never ships a red commit); ${local}`;
  if (state === "missing") return `push the commit to origin and wait for CI (cut only the origin/main tip); ${local}`;
  return `check gh (gh auth status) and the network, then re-run; ${local}`;
}

/** Ask GitHub for the check runs on `sha` and judge them. Never throws.
 *  Returns { ok, state, sha, slug, checks, problems, fix } with state one of
 *  "ok" | "pending" | "failure" | "missing" | "error". */
function queryRequiredChecks({ repoRoot, sha, ghBin = "gh", gitBin = "git", env = process.env } = {}) {
  const out = (state, extra) => {
    const r = { ok: state === "ok", state, sha: sha || null, slug: null, checks: [], problems: [], ...extra };
    if (!r.ok) r.fix = fixFor(state);
    return r;
  };
  if (!sha || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return out("error", { problems: [`not a full commit sha: ${sha || "(empty)"}`] });
  const remote = spawnSync(gitBin, ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8", env, shell: false });
  const slug = remote.status === 0 ? repoSlugFromUrl((remote.stdout || "").trim()) : null;
  if (!slug) return out("error", { problems: ["origin is not a github.com remote, so its CI checks cannot be read"] });
  const apiPath = `repos/${slug.owner}/${slug.repo}/commits/${sha}/check-runs?per_page=100`;
  const r = spawnSync(ghBin, ["api", apiPath], { cwd: repoRoot, encoding: "utf8", env, shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return out("error", { slug, problems: [`gh could not be run (${ghBin}): ${r.error.message}`] });
  if (r.status !== 0) {
    const why = String(r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-3).join(" ").trim();
    return out("error", { slug, problems: [`gh api ${apiPath} exited ${r.status}${why ? `: ${why}` : ""}`] });
  }
  let body;
  try {
    body = JSON.parse(r.stdout || "");
  } catch (e) {
    return out("error", { slug, problems: [`gh api reply is not JSON: ${e.message}`] });
  }
  const judged = evaluateCheckRuns(body, sha);
  return out(judged.state, { slug, checks: judged.checks, problems: judged.problems });
}

export { REQUIRED_CHECKS, REQUIRED_APP, repoSlugFromUrl, evaluateCheckRuns, queryRequiredChecks, fixFor };

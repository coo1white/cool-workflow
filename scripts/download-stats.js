#!/usr/bin/env node
"use strict";

// download-stats — a rough "real user" view of npm downloads and GitHub
// clones, with the operator's own dev installs and CI checkouts taken out.
//
// Consumer: the operator, by hand (like mirror-to-gitea.js). Not shipped.
//
//   node scripts/download-stats.js                 # last 14 days, a table
//   node scripts/download-stats.js --days 30       # npm side for 30 days
//   node scripts/download-stats.js --json          # the same rows as JSON
//   node scripts/download-stats.js log [N]         # record N (default 1) dev
//                                                  # installs from npm today
//
// Neither npm nor GitHub can drop one person's downloads from their counts,
// so this is an ESTIMATE, not a filter:
//   npm   real ≈ npm downloads − your logged dev installs
//   clone real ≈ GitHub clones − CI job checkouts (each Actions job clones)
// Days within 2 days after an npm publish are flagged: registry mirrors and
// scanners fetch every new version, so those days run high.
//
// Dev log: $CW_DEV_DOWNLOADS, default ~/.cw-dev-downloads.json, a map of
// { "YYYY-MM-DD": count }. Kept out of the repo on purpose.
// GitHub traffic needs a token with push access to the repo: GITHUB_TOKEN
// (or GH_TOKEN). Without one, the GitHub columns are left empty.
// Test hooks: CW_STATS_NPM_FIXTURE / CW_STATS_GH_FIXTURE read JSON files in
// place of the network.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PKG = "cool-workflow";
const REPO = "coo1white/cool-workflow";
const GH = "https://api.github.com";

function die(msg) {
  process.stderr.write(`download-stats: ${msg}\n`);
  process.exit(1);
}

function day(d) {
  return d.toISOString().slice(0, 10);
}

function devLogPath() {
  return process.env.CW_DEV_DOWNLOADS || path.join(os.homedir(), ".cw-dev-downloads.json");
}

function readDevLog() {
  const file = devLogPath();
  if (!fs.existsSync(file)) return {};
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    die(`${file}: not valid JSON (${err.message})`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) die(`${file}: must be a { "YYYY-MM-DD": count } map`);
  for (const [k, v] of Object.entries(data)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Number.isInteger(v) || v < 0) die(`${file}: bad entry ${k}: ${v}`);
  }
  return data;
}

function logDev(n) {
  const file = devLogPath();
  const data = readDevLog();
  const today = day(new Date());
  data[today] = (data[today] || 0) + n;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  process.stderr.write(`download-stats: ${today} now has ${data[today]} dev install(s) in ${file}\n`);
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": "cw-download-stats", ...headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function npmData(days) {
  if (process.env.CW_STATS_NPM_FIXTURE) return JSON.parse(fs.readFileSync(process.env.CW_STATS_NPM_FIXTURE, "utf8"));
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const range = await getJson(`https://api.npmjs.org/downloads/range/${day(start)}:${day(end)}/${PKG}`);
  const meta = await getJson(`https://registry.npmjs.org/${PKG}`);
  return { downloads: range.downloads, time: meta.time };
}

async function ghData() {
  if (process.env.CW_STATS_GH_FIXTURE) return JSON.parse(fs.readFileSync(process.env.CW_STATS_GH_FIXTURE, "utf8"));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return null;
  const h = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" };
  const clones = await getJson(`${GH}/repos/${REPO}/traffic/clones`, h);
  const views = await getJson(`${GH}/repos/${REPO}/traffic/views`, h);
  // Traffic covers the last 14 days; count Actions jobs over the same days.
  const since = day(new Date(Date.now() - 14 * 86400000));
  const jobs = {};
  for (let page = 1; page <= 10; page++) {
    const runs = await getJson(`${GH}/repos/${REPO}/actions/runs?created=%3E%3D${since}&per_page=100&page=${page}`, h);
    for (const run of runs.workflow_runs) {
      const j = await getJson(`${GH}/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=1&filter=all`, h);
      const d = run.created_at.slice(0, 10);
      jobs[d] = (jobs[d] || 0) + j.total_count;
    }
    if (runs.workflow_runs.length < 100) break;
  }
  return { clones: clones.clones, views: views.views, jobs };
}

function build(npm, gh, dev) {
  const publishDays = Object.entries(npm.time || {})
    .filter(([k]) => k !== "created" && k !== "modified")
    .map(([, t]) => new Date(t).getTime());
  const rows = new Map();
  const row = (d) => {
    if (!rows.has(d)) rows.set(d, { day: d });
    return rows.get(d);
  };
  for (const { day: d, downloads } of npm.downloads) {
    const r = row(d);
    const t = Date.parse(`${d}T00:00:00Z`);
    r.npm = downloads;
    r.dev = dev[d] || 0;
    r.npmEst = Math.max(0, downloads - r.dev);
    r.afterRelease = publishDays.some((p) => t + 86400000 > p && t - p < 2 * 86400000);
  }
  if (gh) {
    for (const c of gh.clones) {
      const r = row(c.timestamp.slice(0, 10));
      r.clones = c.count;
      r.cloners = c.uniques;
      r.ciJobs = gh.jobs[r.day] || 0;
      r.clonesEst = Math.max(0, c.count - r.ciJobs);
    }
    for (const v of gh.views) row(v.timestamp.slice(0, 10)).visitors = v.uniques;
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function table(rows, hasGh) {
  const cols = [
    ["day", "day"], ["npm", "npm"], ["dev", "you"], ["npmEst", "npm-real≈"], ["afterRelease", "release"],
  ];
  if (hasGh) cols.push(["clones", "clones"], ["ciJobs", "ci-jobs"], ["clonesEst", "clones-real≈"], ["visitors", "visitors"]);
  const cell = (r, k) => (k === "afterRelease" ? (r[k] ? "*" : "") : r[k] === undefined ? "" : String(r[k]));
  const widths = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => cell(r, k).length)));
  const line = (vals) => vals.map((v, i) => (i === 0 ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join("  ");
  const out = [line(cols.map(([, h]) => h))];
  for (const r of rows) out.push(line(cols.map(([k]) => cell(r, k))));
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const quiet = rows.filter((r) => r.npm !== undefined && !r.afterRelease);
  out.push("");
  out.push(`npm: ${sum("npm")} total, ${sum("dev")} yours, about ${sum("npmEst")} others`);
  out.push(`npm on days away from a release: about ${quiet.reduce((s, r) => s + r.npmEst, 0)} others over ${quiet.length} days`);
  if (hasGh) out.push(`clones: ${sum("clones")} total, ${sum("ciJobs")} CI jobs, about ${sum("clonesEst")} others`);
  else out.push("GitHub columns left out: set GITHUB_TOKEN (push access) to add clones and visitors.");
  return out.join("\n") + "\n";
}

async function main(argv) {
  if (argv[0] === "log") {
    const n = argv[1] === undefined ? 1 : Number(argv[1]);
    if (!Number.isInteger(n) || n < 1) die("log takes a whole number of installs, 1 or more");
    logDev(n);
    return;
  }
  let days = 14;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--days") {
      days = Number(argv[++i]);
      if (!Number.isInteger(days) || days < 1 || days > 540) die("--days takes 1 to 540");
    } else die(`unknown argument: ${argv[i]}`);
  }
  const dev = readDevLog();
  const [npm, gh] = await Promise.all([npmData(days), ghData()]);
  const rows = build(npm, gh, dev);
  process.stdout.write(json ? JSON.stringify(rows, null, 2) + "\n" : table(rows, !!gh));
}

main(process.argv.slice(2)).catch((err) => die(err.message));

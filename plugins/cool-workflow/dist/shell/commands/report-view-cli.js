// shell/commands/report-view-cli.ts — `cw report [run-id] [--open|--show]`.
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { cwdArg } from "../../core/util/cli-args.js";
import { reportToHtml } from "../../core/format/report-html.js";
import { latestRunId, loadRun } from "../run-store.js";
import { writeReport } from "../report.js";
/** The named run, or the newest run under this repo's .cw/runs/. */
export function resolveReportRunId(runId, args) {
    return runId || latestRunId(cwdArg(args));
}
/** Writes report.md (and report.html) fresh and returns the report.md path. */
export function reportWriteCli(runId, args) {
    return { path: writeReport(loadRun(runId, cwdArg(args))) };
}
/** The argv that opens a file in its default app, the file last. CW_OPENER
 *  when set; else open (macOS) or xdg-open. */
export function openerArgv(file, env = process.env, platform = process.platform) {
    if (env.CW_OPENER)
        return [env.CW_OPENER, file];
    if (platform === "darwin")
        return ["open", file];
    return ["xdg-open", file];
}
/** Writes report.html beside report.md when missing or older, and opens it
 *  with openerArgv, argv-style. Throws when the opener fails, so no caller
 *  records "opened" when nothing ran. */
export function ensureAndOpenReportHtml(mdPath) {
    const htmlPath = mdPath.replace(/\.md$/, ".html");
    const htmlMtime = fs.existsSync(htmlPath) ? fs.statSync(htmlPath).mtimeMs : -1;
    if (htmlMtime < fs.statSync(mdPath).mtimeMs)
        fs.writeFileSync(htmlPath, reportToHtml(fs.readFileSync(mdPath, "utf8")), "utf8");
    const [opener, ...openArgs] = openerArgv(htmlPath);
    const r = spawnSync(opener, openArgs, { stdio: "ignore", shell: false });
    if (r.error || r.status !== 0)
        throw new Error(`report.html is at ${htmlPath} but the opener "${opener}" failed: ${r.error ? r.error.message : `exit ${r.status}`}`);
    return htmlPath;
}
export function reportOpenCli(runId, args) {
    return { path: ensureAndOpenReportHtml(reportWriteCli(runId, args).path) };
}
/** `cw report --show`: report.md's text, written fresh. */
export function reportShowText(runId, args) {
    return fs.readFileSync(reportWriteCli(runId, args).path, "utf8");
}
